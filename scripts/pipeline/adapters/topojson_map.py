"""TopoJSON 地圖 adapter：把預先投影的 TopoJSON 轉成 SVG 路徑。

讀取 npm 套件封存檔內的 TopoJSON，解碼弧線與量化座標，把指定的幾何集合轉換為 SVG path 字串，網站直接繪製，不在瀏覽器計算投影。設定宣告基本單位（村里）時，縣市與鄉鎮由基本單位合併，選區也由 geo 階段以同一套合併畫出。

指令：
  由 geo 階段經 adapter 登錄表呼叫 extract_map，不單獨執行。

慣例：
  - 來源的座標已經投影成螢幕座標（y 向下），這裡解碼弧線並取捨小數位，投影沿用來源的設定。
  - 路徑以 M 起筆、l 寫相對位移、z 閉合，填色規則用 evenodd，島嶼與飛地都能正確顯示。
  - 屬性欄位依設定改名，網站只認設定宣告的鍵。
  - 合併只看拓撲：同一組幾何中只用到一次的弧線是外框，用到兩次的是內部的共用邊，相鄰單位合併後不會留下縫隙。
"""

import io
import json
import tarfile

from ..common import PipelineError

# ==================================================
# 解碼
# ==================================================


def decode_arcs(topology):
    """把量化、差分編碼的弧線還原成座標。

    參數：
        topology：TopoJSON 物件。
    回傳：弧線串列，每條弧線是 (x, y) 的串列。
    例外：PipelineError，缺少 `transform` 表示弧線沒有量化，與預期的來源格式不符。
    """
    transform = topology.get("transform")
    # 套件的檔案都有量化，沒有 transform 時座標的意義不同
    if transform is None:
        raise PipelineError("TopoJSON 沒有 transform，不是量化過的檔案")
    # 量化座標乘上縮放再加上平移，還原成投影後的座標
    (scale_x, scale_y), (shift_x, shift_y) = transform["scale"], transform["translate"]
    arcs = []
    # 每條弧線的第一點是絕對量化值，其後各點是與前一點的差
    for arc in topology["arcs"]:
        x = y = 0
        points = []
        # 累加差分後套上縮放與平移
        for dx, dy in arc:
            x += dx
            y += dy
            # 換算成投影座標後納入這條弧線
            points.append((x * scale_x + shift_x, y * scale_y + shift_y))
        arcs.append(points)
    return arcs


def ring_points(ring, arcs):
    """把一個環的弧線索引串成座標。

    參數：
        ring：弧線索引串列，負數 ~i 表示第 i 條弧線反向。
        arcs：decode_arcs 的回傳值。
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


def polygons_of(geometry):
    """取出幾何中的多邊形，每個多邊形是環的串列。

    參數：
        geometry：TopoJSON 的一個幾何。
    回傳：多邊形串列。
    例外：PipelineError，幾何類型不是 Polygon 或 MultiPolygon。
    """
    # Polygon 的 arcs 是環的串列，視為一個多邊形
    if geometry["type"] == "Polygon":
        return [geometry["arcs"]]
    # MultiPolygon 的 arcs 已是多邊形的串列
    if geometry["type"] == "MultiPolygon":
        return geometry["arcs"]
    raise PipelineError(
        f"地圖幾何只支援 Polygon 與 MultiPolygon，遇到 {geometry['type']}"
    )


def ring_path(points, digits):
    """把一個環寫成相對座標的子路徑。

    起點用絕對座標，其後各點寫與前一點的差，數字較短，檔案約小一半。差值由取捨後的絕對座標相減，不會累積誤差。
    參數：
        points：(x, y) 的串列，不含回到起點的終點。
        digits：座標保留的小數位數。
    回傳：「Mx y lx y x y ... z」形式的字串。
    """
    # 先取捨絕對座標，差值都由取捨後的值相減
    rounded = [(round(x, digits), round(y, digits)) for x, y in points]
    (start_x, start_y), rest = rounded[0], rounded[1:]
    # 起點寫成 M，其後的點從起點開始累計差值
    steps = []
    previous = rounded[0]
    # 逐點寫出與前一點的差，差為零的點不影響形狀，略過
    for point in rest:
        dx, dy = round(point[0] - previous[0], digits), round(
            point[1] - previous[1], digits
        )
        # 取捨後與前一點重合的點不寫出
        if dx or dy:
            steps.append(f"{dx:g} {dy:g}")
        previous = point
    return f"M{start_x:g} {start_y:g}l{' '.join(steps)}z"


def svg_path(geometry, arcs, digits):
    """把一個幾何轉換為 SVG path 字串。

    參數：
        geometry：TopoJSON 的一個幾何。
        arcs：decode_arcs 的回傳值。
        digits：座標保留的小數位數。
    回傳：(path, 環數)。每個環是 ring_path 寫出的子路徑。
    例外：PipelineError，環少於 4 點或首尾不相接，表示來源幾何損壞。
    """
    parts = []
    # 逐個多邊形、逐個環轉成子路徑
    for polygon in polygons_of(geometry):
        # 外環與內環都寫成子路徑，evenodd 填色會把內環挖空
        for ring in polygon:
            points = ring_points(ring, arcs)
            # 閉合環至少要有三個不同的點加上回到起點
            if len(points) < 4 or points[0] != points[-1]:
                raise PipelineError("地圖幾何有未閉合或點數不足的環")
            parts.append(ring_path(points[:-1], digits))
    return "".join(parts), len(parts)


def arc_number(index):
    """弧線索引對應的弧線編號，反向使用的 ~i 與 i 是同一條弧線。"""
    return index if index >= 0 else ~index


def arc_ends(index, arcs):
    """帶方向的弧線的起點與終點。

    參數：
        index：弧線索引，負數表示反向。
        arcs：decode_arcs 的回傳值。
    回傳：(起點, 終點)。
    """
    points = arcs[arc_number(index)]
    # 反向使用時起點與終點對調
    return (points[0], points[-1]) if index >= 0 else (points[-1], points[0])


def merged_rings(polygons, arcs):
    """把一組多邊形合併成外框的環。

    參數：
        polygons：多邊形串列，每個多邊形是環的串列，環是弧線索引的串列。
        arcs：decode_arcs 的回傳值，用來比對弧線的端點。
    回傳：環的串列，每個環是帶方向的弧線索引串列。
    例外：PipelineError，外框的弧線接不成閉合的環，表示來源拓撲損壞。
    """
    # 攤平成帶方向的弧線索引，合併只看拓撲
    indexes = [index for polygon in polygons for ring in polygon for index in ring]
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
    rings = []
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
            following = [
                index for index in starts.get(current, []) if index not in used
            ]
            # 找不到下一條弧線表示拓撲損壞
            if not following:
                raise PipelineError("合併的外框接不成閉合的環")
            # 接上下一條弧線，終點往前推進
            ring.append(following[0])
            used.add(following[0])
            current = arc_ends(following[0], arcs)[1]
        # 閉合的環加入結果
        rings.append(ring)
    return rings


def signed_area(points):
    """環的帶號面積。來源的螢幕座標 y 向下，外環是負值，內環是正值。"""
    pairs = zip(points, points[1:])
    return sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in pairs) / 2


def merged_path(polygons, arcs, digits, outside=frozenset()):
    """把一組多邊形合併後寫成 SVG path 字串。

    參數：
        polygons：多邊形串列，見 merged_rings。
        arcs：decode_arcs 的回傳值。
        digits：座標保留的小數位數。
        outside：另一側沒有任何單位的弧線編號，海岸線與來源沒有劃入村里的空白都是。
    回傳：(path, 環數)。
    """
    parts = []
    # 每個外框環寫成一個子路徑，evenodd 填色會把內環挖空
    for ring in merged_rings(polygons, arcs):
        points = ring_points(ring, arcs)
        # 每條邊的另一側都沒有單位的內環是被這組幾何包住的空白，補起來不畫成洞
        if signed_area(points) > 0 and all(arc_number(i) in outside for i in ring):
            continue
        parts.append(ring_path(points[:-1], digits))
    return "".join(parts), len(parts)


def outside_arcs(units):
    """另一側沒有任何單位的弧線編號。

    參數：
        units：read_units 的回傳值。
    回傳：弧線編號的集合，只被一個單位用到的弧線。
    """
    # 攤平全部單位的弧線，相鄰單位的共用邊會出現兩次
    indexes = [
        index
        for unit in units
        for polygon in unit["polygons"]
        for ring in polygon
        for index in ring
    ]
    counts = {}
    # 依弧線編號計數，方向不同的同一條弧線算同一條
    for index in indexes:
        counts[arc_number(index)] = counts.get(arc_number(index), 0) + 1
    # 只出現一次的弧線另一側沒有任何單位
    return frozenset(number for number, count in counts.items() if count == 1)


def bounds(topology, arcs):
    """計算全部弧線的外框。

    參數：
        topology：TopoJSON 物件，有 bbox 時直接採用。
        arcs：decode_arcs 的回傳值。
    回傳：(最小 x, 最小 y, 最大 x, 最大 y)。
    """
    # 套件附 bbox 時直接採用
    if "bbox" in topology:
        return tuple(topology["bbox"])
    # 沒有 bbox 時由全部弧線的座標求出
    xs = [x for arc in arcs for x, _ in arc]
    ys = [y for arc in arcs for _, y in arc]
    return min(xs), min(ys), max(xs), max(ys)


# ==================================================
# 匯出
# ==================================================


def read_units(topology, settings):
    """讀出基本單位，每筆帶設定宣告的屬性與多邊形。

    參數：
        topology：TopoJSON 物件。
        settings：geography.yaml 的內容，取 units。
    回傳：`[{屬性..., "polygons": [...]}]`，依來源的幾何順序。
    例外：PipelineError，基本單位的集合不存在。
    """
    collection = topology["objects"].get(settings["units"]["object"])
    # 設定的集合名稱要在檔案內
    if collection is None:
        raise PipelineError(f"TopoJSON 沒有 {settings['units']['object']} 集合")
    units = []
    # 每個幾何保留改名後的屬性與弧線索引，合併時才轉成路徑
    for geometry in collection["geometries"]:
        properties = geometry.get("properties", {})
        fields = settings["units"]["fields"].items()
        # 只留設定宣告的屬性，geo 階段依這些鍵比對名冊
        renamed = {key: properties[source] for key, source in fields}
        units.append(renamed | {"polygons": polygons_of(geometry)})
    return units


def merged_layer(units, layer, arcs, digits, outside):
    """把基本單位依欄位分組合併成一個圖層。

    參數：
        units：read_units 的回傳值。
        layer：圖層設定，merge 是分組的單位欄位，fields 是產物欄位對應單位欄位。
        arcs：decode_arcs 的回傳值。
        digits：座標保留的小數位數。
        outside：outside_arcs 的回傳值。
    回傳：圖形串列，每個圖形帶 fields 宣告的欄位、path 與 rings。
    """
    groups = {}
    # 同一個分組值的單位合併成一個圖形，屬性取組內第一個單位
    for unit in units:
        groups.setdefault(unit[layer["merge"]], []).append(unit)
    features = []
    # 每組的多邊形合併後寫成路徑
    for members in groups.values():
        polygons = [polygon for unit in members for polygon in unit["polygons"]]
        path_text, rings = merged_path(polygons, arcs, digits, outside)
        # 組內各單位的上層屬性相同，取第一個單位改名
        renamed = {key: members[0][source] for key, source in layer["fields"].items()}
        features.append(renamed | {"path": path_text, "rings": rings})
    return features


def extract_map(path, settings):
    """從套件封存檔讀出 TopoJSON 並轉成網站的地圖資料。

    參數：
        path：封存檔位置。
        settings：geography.yaml 的內容，取 member、digits、units、layers。圖層有 merge 時由基本單位合併，有 object 時直接轉換來源的集合。
    回傳：`{"view_box": [...], "layers": {名稱: [{屬性..., "path": ..., "rings": ...}]}, "units": [...], "draw": 函式}`。draw 接受基本單位的串列，回傳合併後的 (path, rings)，geo 階段以它畫出選區。
    例外：PipelineError，成員不在封存檔、幾何集合不存在或幾何損壞。
    """
    # 封存檔是 npm 套件的 tgz
    with tarfile.open(path, "r:gz") as archive:
        # 成員不在封存檔時，表示套件版本與設定不符
        try:
            member = archive.extractfile(settings["member"])
        # tarfile 以 KeyError 表示成員不存在
        except KeyError as error:
            raise PipelineError(f"封存檔內沒有 {settings['member']}") from error
        topology = json.load(io.TextIOWrapper(member, encoding="utf-8"))
    # 弧線只解碼一次，各圖層共用
    arcs = decode_arcs(topology)
    digits = settings["digits"]
    # 有基本單位時先讀出，合併的圖層與選區都由它組成
    units = read_units(topology, settings) if "units" in settings else []
    # 只屬於一個單位的弧線另一側是海或沒有劃入村里的空白
    outside = outside_arcs(units)
    layers = {}
    # 依設定逐一轉出幾何集合
    for name, layer in settings["layers"].items():
        # 宣告 merge 的圖層由基本單位合併
        if "merge" in layer:
            features = merged_layer(units, layer, arcs, digits, outside)
            first = next(iter(layer["fields"]))
            # 依第一個欄位排序，產物與來源的幾何順序無關
            layers[name] = sorted(features, key=lambda feature: feature[first])
            continue
        collection = topology["objects"].get(layer["object"])
        # 設定的集合名稱要在檔案內
        if collection is None:
            raise PipelineError(f"TopoJSON 沒有 {layer['object']} 集合")
        features = []
        # 每個幾何轉成一筆，屬性依設定改名
        for geometry in collection["geometries"]:
            path_text, rings = svg_path(geometry, arcs, digits)
            # 只留設定宣告的屬性，網站不依賴來源的欄名
            properties = geometry.get("properties", {})
            renamed = {
                key: properties[source] for key, source in layer["fields"].items()
            }
            features.append(renamed | {"path": path_text, "rings": rings})
        # 依第一個欄位排序，產物與來源的幾何順序無關
        first = next(iter(layer["fields"]))
        layers[name] = sorted(features, key=lambda feature: feature[first])
    left, top, right, bottom = bounds(topology, arcs)
    # 外框取整數並向外留一單位，邊緣的線才完整留在畫面內
    view_box = [
        int(left) - 1,
        int(top) - 1,
        int(right - left) + 3,
        int(bottom - top) + 3,
    ]

    # 選區由 geo 階段挑出基本單位後以同一套合併畫出
    def draw(members):
        """把一組基本單位合併成 (path, rings)。"""
        polygons = [polygon for unit in members for polygon in unit["polygons"]]
        return merged_path(polygons, arcs, digits, outside)

    return {"view_box": view_box, "layers": layers, "units": units, "draw": draw}
