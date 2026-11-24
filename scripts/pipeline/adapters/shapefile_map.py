"""Shapefile 地圖 adapter：把內政部的村里界圖轉成網站直接畫出的 SVG 路徑。

讀取壓縮檔內的 Shapefile（SHP 的多邊形與 DBF 的屬性），以相鄰村里共用的頂點切出共用弧線，逐條弧線投影成螢幕座標並簡化，再把村里合併成設定的圖層。

指令：
  由 geo 階段經 adapter 登錄表呼叫 extract_map，不單獨執行。

慣例：
  - 相鄰村里的邊界在來源中是同一串座標，切成共用弧線後只簡化一次，合併與簡化都不會在相鄰村里之間留下縫隙。
  - 投影是 d3 的 Mercator：每個區域以中心經緯度旋轉，乘上比例尺後加上平移與區域的位移。離島以位移排在本島左側，區域依縣市或鄉鎮代碼指定。
  - 路徑以 M 起筆、l 寫相對位移、z 閉合。外環與內環的方向相反，網站以 nonzero 填色，與其他村里重疊的飛地不會被挖空。
  - 合併只看拓撲：同一組單位中只用到一次的弧線是外框，用到兩次的是內部的共用邊。
"""

import math
import struct
import zipfile

from ..common import PipelineError

# ==================================================
# 集中設定
# ==================================================

# SHP 檔頭的長度，第一筆紀錄從這個位置起
SHP_HEADER_BYTES = 100

# SHP 的多邊形類型代碼，村里界圖只有這一種
SHP_POLYGON = 5

# DBF 欄位描述區的結尾記號
DBF_FIELDS_END = 0x0D

# DBF 紀錄的刪除記號，被刪除的紀錄不讀
DBF_DELETED = 0x2A

# 區域的位移與方框寬高以比例尺為這個值時的螢幕座標為單位，隨比例尺等比縮放
OFFSET_SCALE = 10000

# ==================================================
# 讀檔
# ==================================================


def read_member(archive, name):
    """讀出壓縮檔內的一個成員。

    參數：
        archive：zipfile.ZipFile。
        name：成員的檔名。
    回傳：bytes。
    例外：PipelineError，成員不在壓縮檔內，表示來源版本與設定不符。
    """
    # zipfile 以 KeyError 表示成員不存在
    try:
        return archive.read(name)
    # 成員不存在時改報設定與來源不符
    except KeyError as error:
        raise PipelineError(f"壓縮檔內沒有 {name}") from error


def read_shapes(data):
    """讀出 SHP 每筆紀錄的環。

    參數：
        data：SHP 檔的內容。
    回傳：紀錄串列，每筆是環的串列，環是 (經度, 緯度) 的串列。
    例外：PipelineError，紀錄不是多邊形。
    """
    shapes = []
    position = SHP_HEADER_BYTES
    # 每筆紀錄是大端序的編號與長度（以 16 位元為單位），之後是內容
    while position < len(data):
        _, length = struct.unpack(">ii", data[position : position + 8])
        body = data[position + 8 : position + 8 + length * 2]
        # 下一筆紀錄從這筆內容之後開始
        position += 8 + length * 2
        # 內容依序是類型、外框 32 位元組、環數與點數，都是小端序
        kind, parts, count = struct.unpack("<i32xii", body[:44])
        # 村里界圖只有多邊形，其他類型表示來源格式改變
        if kind != SHP_POLYGON:
            raise PipelineError(f"SHP 紀錄的類型是 {kind}，地圖只支援多邊形")
        # 各環的起點索引之後是全部點的 x、y 浮點數
        starts = struct.unpack(f"<{parts}i", body[44 : 44 + 4 * parts])
        values = struct.unpack(f"<{2 * count}d", body[44 + 4 * parts :])
        # 座標兩兩一組，依各環的起點切開
        points = list(zip(values[0::2], values[1::2]))
        ends = list(starts[1:]) + [count]
        shapes.append([points[a:b] for a, b in zip(starts, ends)])
    return shapes


def read_records(data, encoding):
    """讀出 DBF 每筆紀錄的屬性。

    參數：
        data：DBF 檔的內容。
        encoding：文字欄位的編碼。
    回傳：屬性 dict 的串列，順序與 SHP 的紀錄相同。
    """
    # 檔頭記紀錄數、檔頭長度與每筆紀錄的長度，欄位描述從第 32 位元組起
    count, header, width = struct.unpack("<IHH", data[4:12])
    fields = []
    position = 32
    # 欄位描述每 32 位元組一筆，名稱在前 11 位元組，長度在第 17 位元組
    while data[position] != DBF_FIELDS_END:
        name = data[position : position + 11].split(b"\0")[0].decode("ascii")
        fields.append((name, data[position + 16]))
        # 換下一筆欄位描述
        position += 32
    records = []
    # 每筆紀錄的第一個位元組是刪除記號，其後依欄位長度切開
    for number in range(count):
        row = data[header + number * width : header + (number + 1) * width]
        # 第一個位元組是刪除記號，欄位從第二個位元組起
        offset = 1
        values = {}
        # 每個欄位依長度切出並去掉補齊的空白
        for name, length in fields:
            text = row[offset : offset + length].decode(encoding).strip()
            # 被刪除的紀錄留空，與 SHP 的紀錄位置仍然對齊
            values[name] = text if row[0] != DBF_DELETED else ""
            offset += length
        # 屬性的順序與 SHP 的紀錄相同
        records.append(values)
    return records


# ==================================================
# 拓撲
# ==================================================


def clean_ring(points):
    """去掉環的閉合點與連續重複的點。

    參數：
        points：(x, y) 的串列，首尾相同。
    回傳：不閉合的點串列，相鄰的點都不相同。
    """
    cleaned = []
    # 首尾相同的閉合點只留一個，連續重複的點只留第一個
    for point in points[:-1]:
        # 與前一點不同時才保留
        if not cleaned or cleaned[-1] != point:
            cleaned.append(point)
    # 去重後尾點可能又和首點相同
    while len(cleaned) > 1 and cleaned[-1] == cleaned[0]:
        cleaned.pop()
    return cleaned


def junctions(rings):
    """找出交會點：相鄰的點超過兩個的頂點。

    參數：
        rings：clean_ring 處理過的環。
    回傳：頂點座標的集合。共用邊在這些點開始或結束。
    """
    neighbors = {}
    # 每個頂點記下所有環中與它相鄰的點
    for ring in rings:
        # 環是閉合的，第一點的前一點是最後一點
        for index, point in enumerate(ring):
            near = neighbors.setdefault(point, set())
            # 前後兩點都記下，相鄰的環走過同一點時會補進其他方向的點
            near.add(ring[index - 1])
            near.add(ring[(index + 1) % len(ring)])
    # 相鄰的點超過兩個時，邊界在這裡分岔
    return {point for point, near in neighbors.items() if len(near) > 2}


def ring_arcs(ring, stops, arcs, index):
    """把一個環切成弧線並去重。

    參數：
        ring：clean_ring 處理過的環。
        stops：junctions 的回傳值。
        arcs：已建立的弧線串列，新的弧線加在後面。
        index：`{點的元組: 弧線編號}`，反向的弧線以 ~編號 對應。
    回傳：這個環的帶方向的弧線索引串列。
    """
    cuts = [n for n, point in enumerate(ring) if point in stops]
    # 沒有交會點的環整個是一條閉合的弧線，從最小的點起筆，兩個方向都能對上
    if not cuts:
        start = ring.index(min(ring))
        rotated = ring[start:] + ring[:start]
        # 補回起點，閉合的弧線首尾相同
        pieces = [rotated + [rotated[0]]]
    # 有交會點時從第一個交會點起筆，在每個交會點切開
    else:
        rotated = ring[cuts[0] :] + ring[: cuts[0]]
        # 交會點在轉過的環上的位置，最後一段收到環的終點
        marks = [n - cuts[0] for n in cuts] + [len(ring)]
        closed = rotated + [rotated[0]]
        # 相鄰兩個交會點之間是一段，兩端都含交會點
        pieces = [closed[a : b + 1] for a, b in zip(marks, marks[1:])]
    indexes = []
    # 每段先找相同或反向的既有弧線，都沒有時才新增
    for piece in pieces:
        key = tuple(piece)
        # 相鄰的環以相反方向走過共用邊，反向的點序也要比對
        reverse = tuple(reversed(piece))
        # 已有同向的弧線時沿用，已有反向的弧線時反向沿用
        if key in index:
            indexes.append(index[key])
        # 相鄰的環走過同一段時方向相反，以 ~編號 表示反向使用
        elif reverse in index:
            indexes.append(~index[reverse])
        # 第一次出現的段落是新的弧線
        else:
            index[key] = len(arcs)
            arcs.append(piece)
            # 這個環以正向使用新弧線
            indexes.append(index[key])
    return indexes


def build_topology(shapes):
    """把每筆紀錄的環切成共用弧線。

    參數：
        shapes：read_shapes 的回傳值。
    回傳：(弧線串列, 每筆紀錄的環串列)。弧線是 (經度, 緯度) 的串列，環是帶方向的弧線索引串列。
    """
    cleaned = [[clean_ring(ring) for ring in shape] for shape in shapes]
    # 點數不足三個的環沒有面積，去掉
    cleaned = [[ring for ring in shape if len(ring) >= 3] for shape in cleaned]
    stops = junctions([ring for shape in cleaned for ring in shape])
    arcs, index = [], {}
    # 逐筆、逐環切成弧線，相鄰紀錄的共用邊對到同一條弧線
    units = [
        [ring_arcs(ring, stops, arcs, index) for ring in shape] for shape in cleaned
    ]
    return arcs, units


# ==================================================
# 投影與簡化
# ==================================================


def rotate(longitude, latitude, center):
    """依 d3 的旋轉把中心經緯度轉到原點。

    參數：
        longitude、latitude：度。
        center：區域中心的 [經度, 緯度]。
    回傳：旋轉後的 (經度, 緯度)，弧度。
    """
    # 先沿經度旋轉，再沿緯度旋轉，與 d3 geoRotation([-經度, -緯度]) 相同
    lam = math.radians(longitude - center[0])
    phi = math.radians(latitude)
    delta = math.radians(-center[1])
    # 轉成單位球上的直角座標，繞 y 軸轉 delta
    x = math.cos(lam) * math.cos(phi)
    y = math.sin(lam) * math.cos(phi)
    z = math.sin(phi)
    # 旋轉後的 z 是新緯度的正弦，x、y 決定新經度
    k = z * math.cos(delta) + x * math.sin(delta)
    return math.atan2(y, x * math.cos(delta) - z * math.sin(delta)), math.asin(k)


def projector(projection, region):
    """產生一個區域的投影函式。

    參數：
        projection：地圖設定的 projection，取 scale 與 translate。
        region：區域設定，取 center 與 offset。
    回傳：把 (經度, 緯度) 轉成螢幕座標 (x, y) 的函式。
    """
    scale = projection["scale"]
    # 區域的原點是平移加上依比例尺縮放的位移
    origin_x = projection["translate"][0] + region["offset"][0] * scale / OFFSET_SCALE
    origin_y = projection["translate"][1] + region["offset"][1] * scale / OFFSET_SCALE

    def project(point):
        """Mercator 投影，螢幕的 y 向下。"""
        lam, phi = rotate(point[0], point[1], region["center"])
        mercator = math.log(math.tan(math.pi / 4 + phi / 2))
        return origin_x + scale * lam, origin_y - scale * mercator

    return project


def simplify(points, tolerance):
    """以 Douglas-Peucker 簡化一條弧線，端點固定。

    參數：
        points：(x, y) 的串列。
        tolerance：容許的垂直距離，螢幕座標。
    回傳：簡化後的點串列。閉合的弧線至少留四個點，簡化後仍是一個環。
    """
    keep = {0, len(points) - 1}
    stack = [(0, len(points) - 1)]
    # 每段找離端點連線最遠的點，超過容許距離就保留並再切兩段
    while stack:
        first, last = stack.pop()
        # 這一段的兩個端點與它們的距離
        (ax, ay), (bx, by) = points[first], points[last]
        length = math.hypot(bx - ax, by - ay)
        # 距離不超過容許值的點都可以去掉
        farthest, distance = None, tolerance
        # 逐點量到端點連線的垂直距離
        for n in range(first + 1, last):
            px, py = points[n]
            # 端點重合（閉合弧線）時改量到端點的距離
            gap = (
                abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length
                if length
                else math.hypot(px - ax, py - ay)
            )
            # 記下最遠且超過容許距離的點
            if gap > distance:
                farthest, distance = n, gap
        # 有超過容許距離的點時保留它並繼續切
        if farthest is not None:
            keep.add(farthest)
            stack.extend([(first, farthest), (farthest, last)])
    # 閉合的弧線至少留三等分點，簡化後仍是一個環
    if points[0] == points[-1]:
        third = (len(points) - 1) // 3
        keep |= {third, 2 * third}
    return [points[n] for n in sorted(keep)]


def region_of(record, regions, fields):
    """一筆紀錄所屬的區域。

    參數：
        record：DBF 的屬性。
        regions：地圖設定的 projection.regions，依序比對，最後一個是沒有指定代碼的本島。
        fields：地圖設定的 units.fields，取縣市與鄉鎮代碼的來源欄名。
    回傳：區域設定。
    """
    town = record[fields["town_code"]]
    county = record[fields["county"]]
    # 依序比對鄉鎮代碼與縣市代碼，第一個符合的區域就是
    for region in regions:
        # 鄉鎮代碼先比，烏坵與金門同縣市但在不同的方框
        if town in region.get("towns", []) or county in region.get("counties", []):
            return region
    return regions[-1]


# ==================================================
# 合併
# ==================================================


def arc_number(index):
    """弧線索引對應的弧線編號，反向使用的 ~i 與 i 是同一條弧線。"""
    return index if index >= 0 else ~index


def arc_ends(index, arcs):
    """帶方向的弧線的起點與終點。

    參數：
        index：弧線索引，負數表示反向。
        arcs：弧線串列。
    回傳：(起點, 終點)。
    """
    points = arcs[arc_number(index)]
    # 反向使用時起點與終點對調
    return (points[0], points[-1]) if index >= 0 else (points[-1], points[0])


def ring_points(ring, arcs):
    """把一個環的弧線索引串成座標。

    參數：
        ring：弧線索引串列，負數 ~i 表示第 i 條弧線反向。
        arcs：弧線串列。
    回傳：(x, y) 的串列，相鄰弧線共用的端點只保留一次。
    """
    points = []
    # 依序接上每條弧線
    for index in ring:
        # 負索引是反向使用同一條弧線
        arc = arcs[index] if index >= 0 else list(reversed(arcs[~index]))
        # 第二條弧線起，起點與上一條的終點相同，略過
        points.extend(arc if not points else arc[1:])
    return points


def ring_path(points, digits):
    """把一個環寫成相對座標的子路徑。

    起點用絕對座標，其後各點寫與前一點的差，數字較短。差值由取捨後的絕對座標相減，不會累積誤差。
    參數：
        points：(x, y) 的串列，不含回到起點的終點。
        digits：座標保留的小數位數。
    回傳：「Mx y lx y x y ... z」形式的字串。
    """
    # 先取捨絕對座標，差值都由取捨後的值相減
    rounded = [(round(x, digits), round(y, digits)) for x, y in points]
    (start_x, start_y), rest = rounded[0], rounded[1:]
    # 第一點寫絕對座標，其後的點與前一點相減
    steps = []
    previous = rounded[0]
    # 逐點寫出與前一點的差，取捨後與前一點重合的點不寫出
    for point in rest:
        dx = round(point[0] - previous[0], digits)
        dy = round(point[1] - previous[1], digits)
        # 差為零的點不影響形狀
        if dx or dy:
            steps.append(f"{dx:g} {dy:g}")
        previous = point
    return f"M{start_x:g} {start_y:g}l{' '.join(steps)}z"


def merged_rings(rings, arcs):
    """把一組環合併成外框的環。

    參數：
        rings：環的串列，環是帶方向的弧線索引串列。
        arcs：弧線串列，用來比對弧線的端點。
    回傳：環的串列，每個環是帶方向的弧線索引串列。
    例外：PipelineError，外框的弧線接不成閉合的環，表示來源拓撲損壞。
    """
    # 攤平成帶方向的弧線索引，合併只看拓撲
    indexes = [index for ring in rings for index in ring]
    counts = {}
    # 計算每條弧線出現的次數，相鄰兩個單位的共用邊會出現兩次
    for index in indexes:
        counts[arc_number(index)] = counts.get(arc_number(index), 0) + 1
    # 只出現一次的弧線是外框，保留原本的方向
    boundary = [index for index in indexes if counts[arc_number(index)] == 1]
    starts = {}
    # 依起點索引外框弧線，接環時由終點找下一條
    for index in boundary:
        starts.setdefault(arc_ends(index, arcs)[0], []).append(index)
    # 記下已經接進環的弧線，每條外框弧線只用一次
    used = set()
    merged = []
    # 每次從還沒用過的弧線起筆，接到回到起點為止
    for first in boundary:
        # 已經接進前面某個環的弧線不再起筆
        if first in used:
            continue
        # 起筆的弧線是環的第一段，記下起點以判斷何時閉合
        ring, origin, current = [first], *arc_ends(first, arcs)
        used.add(first)
        # 終點回到起點時這個環閉合
        while current != origin:
            # 從終點出發、還沒用過的外框弧線是下一段
            following = [i for i in starts.get(current, []) if i not in used]
            # 找不到下一條弧線表示拓撲損壞
            if not following:
                raise PipelineError("合併的外框接不成閉合的環")
            # 接上下一條弧線，終點往前推進
            ring.append(following[0])
            used.add(following[0])
            current = arc_ends(following[0], arcs)[1]
        # 閉合的環加入結果
        merged.append(ring)
    return merged


def signed_area(points):
    """環的帶號面積，正負號表示環的方向。"""
    pairs = zip(points, points[1:] + points[:1])
    return sum(ax * by - bx * ay for (ax, ay), (bx, by) in pairs) / 2


def merged_path(rings, arcs, digits):
    """把一組環合併後寫成 SVG path 字串。

    參數：
        rings：環的串列，見 merged_rings。
        arcs：弧線串列。
        digits：座標保留的小數位數。
    回傳：(path, 環數)。
    """
    parts = []
    # 每個外框環寫成一個子路徑，內環與外環方向相反，nonzero 填色會把它挖空
    for ring in merged_rings(rings, arcs):
        points = ring_points(ring, arcs)[:-1]
        # 面積小於座標精度的環看不見，簡化後的方向也不可靠，不畫
        if abs(signed_area(points)) < 10**-digits:
            continue
        parts.append(ring_path(points, digits))
    return "".join(parts), len(parts)


# ==================================================
# 匯出
# ==================================================


def region_box(region, projection):
    """一個區域在螢幕上的方框。

    參數：
        region：區域設定，取 offset 與 size。
        projection：地圖設定的 projection。
    回傳：(左, 上, 右, 下)。
    """
    scale = projection["scale"] / OFFSET_SCALE
    # 方框以區域的原點為中心，寬高依設定
    center_x = projection["translate"][0] + region["offset"][0] * scale
    center_y = projection["translate"][1] + region["offset"][1] * scale
    half_w, half_h = region["size"][0] * scale / 2, region["size"][1] * scale / 2
    return center_x - half_w, center_y - half_h, center_x + half_w, center_y + half_h


def box_path(region, projection, digits):
    """一個插圖區域的外框路徑。"""
    left, top, right, bottom = region_box(region, projection)
    corners = [(left, top), (right, top), (right, bottom), (left, bottom)]
    return ring_path(corners, digits)


def inside(points, box):
    """一組點是否有任何一點落在方框內。"""
    left, top, right, bottom = box
    return any(left <= x <= right and top <= y <= bottom for x, y in points)


def merged_layer(units, layer, arcs, digits):
    """把基本單位依欄位分組合併成一個圖層。

    參數：
        units：基本單位，每筆帶屬性與 rings。
        layer：圖層設定，merge 是分組的單位欄位，fields 是產物欄位對應單位欄位。
        arcs：弧線串列。
        digits：座標保留的小數位數。
    回傳：圖形串列，依第一個欄位排序，每個圖形帶 fields 宣告的欄位、path 與 rings。
    """
    groups = {}
    # 同一個分組值的單位合併成一個圖形，屬性取組內第一個單位
    for unit in units:
        groups.setdefault(unit[layer["merge"]], []).append(unit)
    features = []
    # 每組的環合併後寫成路徑
    for members in groups.values():
        rings = [ring for unit in members for ring in unit["rings"]]
        path_text, count = merged_path(rings, arcs, digits)
        # 組內各單位的上層屬性相同，取第一個單位改名
        renamed = {key: members[0][source] for key, source in layer["fields"].items()}
        features.append(renamed | {"path": path_text, "rings": count})
    first = next(iter(layer["fields"]))
    return sorted(features, key=lambda feature: feature[first])


def project_arcs(arcs, records, rings, settings):
    """依每條弧線所屬的區域投影並簡化。

    參數：
        arcs：build_topology 的弧線，經緯度。
        records：DBF 的屬性。
        rings：build_topology 的每筆紀錄的環。
        settings：地圖設定。
    回傳：(螢幕座標的弧線串列, 每筆紀錄所屬的區域)。
    """
    projection, fields = settings["projection"], settings["units"]["fields"]
    regions = [region_of(record, projection["regions"], fields) for record in records]
    owner = {}
    # 弧線屬於使用它的紀錄的區域，離島與本島不共用弧線
    for region, shape in zip(regions, rings):
        # 第一個用到弧線的紀錄決定它的區域
        for index in (i for ring in shape for i in ring):
            owner.setdefault(arc_number(index), region["name"])
    # 每個區域一個投影函式，依區域的中心與位移
    projectors = {r["name"]: projector(projection, r) for r in projection["regions"]}
    # 端點由同一個函式投影，相鄰弧線的端點仍然相同
    projected = [
        simplify([projectors[owner[n]](p) for p in arc], settings["simplify"])
        for n, arc in enumerate(arcs)
    ]
    return projected, regions


def extract_map(path, settings):
    """從壓縮檔讀出村里界圖並轉成網站的地圖資料。

    參數：
        path：壓縮檔位置。
        settings：geography.yaml 的內容，取 shapes、encoding、digits、simplify、projection、units、layers。
    回傳：`{"view_box": [...], "layers": {名稱: [...]}, "arcs": [...], "units": [...]}`。arcs 是螢幕座標的弧線，units 是每個村里設定宣告的屬性與 rings（帶方向的弧線索引串列）。
    例外：PipelineError，成員不在壓縮檔、紀錄不是多邊形或拓撲損壞。
    """
    shapes, records = [], []
    # 壓縮檔內同名的 SHP 與 DBF 是一組圖形，設定列出的各組一起讀
    with zipfile.ZipFile(path) as archive:
        # SHP 與 DBF 的紀錄一一對應，兩者依同樣的順序接起來
        for name in settings["shapes"]:
            shapes += read_shapes(read_member(archive, f"{name}.shp"))
            records += read_records(
                read_member(archive, f"{name}.dbf"), settings["encoding"]
            )
    # 先在經緯度上切出共用弧線，投影與簡化都以弧線為單位
    arcs, rings = build_topology(shapes)
    arcs, regions = project_arcs(arcs, records, rings, settings)
    # 合併、方框與村里屬性用到的設定
    projection, digits = settings["projection"], settings["digits"]
    fields = settings["units"]["fields"]
    units = []
    # 整個落在區域方框外的環不畫，例如本島方框外的東沙與南沙
    for record, region, shape in zip(records, regions, rings):
        box = region_box(region, projection)
        # 環有任何一點在方框內就保留
        kept = [ring for ring in shape if inside(ring_points(ring, arcs), box)]
        # 只留設定宣告的屬性，geo 階段依這些鍵比對名冊
        unit = {key: record[source] for key, source in fields.items()}
        units.append(unit | {"rings": kept})
    # 沒有保留任何環的村里不參與合併
    layers = {
        name: merged_layer([u for u in units if u["rings"]], layer, arcs, digits)
        for name, layer in settings["layers"].items()
    }
    # 插圖區域的外框是設定的方框，本島不畫框
    frames = [r for r in projection["regions"] if r.get("frame")]
    layers["insets"] = [
        {
            "code": r["name"],
            "name": r["name"],
            "path": box_path(r, projection, digits),
            "rings": 1,
        }
        for r in frames
    ]
    boxes = [region_box(r, projection) for r in projection["regions"]]
    # 畫面的範圍是全部區域方框的外框，向外留一單位，邊緣的線才完整留在畫面內
    left, top = min(b[0] for b in boxes), min(b[1] for b in boxes)
    right, bottom = max(b[2] for b in boxes), max(b[3] for b in boxes)
    view_box = [
        int(left) - 1,
        int(top) - 1,
        int(right - left) + 3,
        int(bottom - top) + 3,
    ]
    return {"view_box": view_box, "layers": layers, "arcs": arcs, "units": units}
