"""來源 adapter 的登錄表。

用途：來源登錄（sources.yaml 與主題測驗設定的 sources）以 adapter 名稱指定每個來源的處理方式，抽取層、地圖步驟與 topic 指令依名稱查這張表取得處理函式。新增一種來源時在這裡登錄，各層程式不改。
指令：由抽取層、地圖步驟與 topic 指令匯入，不單獨執行。
慣例：
  - 每個 adapter 提供 roster（匯入名冊）、document（抽取一份文件）、geography（轉出選區地圖）、topic（讀出主題測驗的原始題目）、comparison（取出主題測驗單選題的對照比例）能力中的一種以上。
  - 能力的參數形狀固定：`roster(檔案位置, 來源登錄, 選舉設定)`、`document(檔案位置, 來源登錄, 文件設定, 影像目錄)`、`geography(檔案位置, 地圖設定)`、`topic(角色對應檔案位置)`、`comparison(檔案位置, 對照設定)`。
  - 設定引用、adapter 卻沒有提供的能力，由查表的那一步回報錯誤。
"""

from . import cec_bulletin, cec_roster, eightvalues, mac_polls, text_sources, topojson_map

# adapter 名稱對應能力與處理函式，函式在這裡把固定形狀的參數轉給各 adapter
ADAPTERS = {
    "cec-roster": {
        "roster": lambda path, source, election: cec_roster.extract_roster(
            path, source["name_encoding"], election
        ),
    },
    "cec-bulletin": {
        "document": lambda path, source, document, image_dir: cec_bulletin.extract_document(
            path, source["name_encoding"], document, image_dir
        ),
    },
    "web-snapshot": {
        "document": lambda path, source, document, image_dir: text_sources.extract_web_snapshot(
            path, document
        ),
    },
    "ly-open-data": {
        "document": lambda path, source, document, image_dir: text_sources.extract_legislature(
            path, document, source
        ),
    },
    "eightvalues": {
        "topic": lambda paths: eightvalues.extract_topic(paths),
    },
    "mac-polls": {
        "comparison": lambda path, spec: mac_polls.extract_comparison(path, spec),
    },
    "topojson-map": {
        "geography": lambda path, settings: topojson_map.extract_map(path, settings),
    },
    "custom": {
        "document": lambda path, source, document, image_dir: text_sources.extract_custom(
            document
        ),
    },
}
