"""主題測驗階段的測試。

測試主題測驗階段的核對與工具：通過的資料、每一種不符規格的資料，以及工具寫出的檔案。規則見 docs/pipeline/ 的同名文件。

指令：
  `npm test`

慣例：
  - 以已提交的資料測試通過的情形，以記憶體中修改過的副本測試錯誤的情形。
  - 寫入檔案的測試把資料目錄換成暫存目錄。
"""

import unittest

from pipeline.common import (
    CACHE_DIR,
    PipelineError,
    read_json,
    topic_config,
    topic_ids,
    topic_product_path,
)
from pipeline.publish.run import INDEX_PATH
from pipeline.tables import by_code, review_names
from pipeline.topics.run import (
    axis_rows,
    build_dataset,
    check_axes,
    option_rows,
    read_authored,
    reference_rows,
    topic_sources,
)

# 有原始檔的兩套主題測驗：只有量尺題的 8values，與含單選題的兩岸立場
TOPIC = "8values"
CHOICE_TOPIC = "cross-strait"

# 探索性題組：題目與軸由本站編寫，沒有參照點
STATUS_TOPIC = "taiwan-status"

# 方法與審核狀態的登錄名稱，軸對應的審核欄依此核對
REVIEW = review_names()


# 直接執行本檔時執行全部測試
if __name__ == "__main__":
    unittest.main()


class TopicTest(unittest.TestCase):
    """主題測驗的手寫表、發布檔與錯誤情形。"""

    def test_config_and_tables(self):
        """8values 的四條軸各有七級標籤，70 題都有軸對應，52 個參照點都有四軸位置。"""
        self.assertIn(TOPIC, topic_ids())
        # 軸的順序即雷達圖的順序，每軸七級
        axes = check_axes(topic_config(TOPIC))
        self.assertEqual(
            [axis["code"] for axis in axes], ["econ", "dipl", "govt", "scty"]
        )
        self.assertTrue(all(len(axis["bands"]) == 7 for axis in axes))
        # 手寫表都能通過核對，軸對應與參照點逐列解析，筆數不變
        questions, links, references = read_authored(TOPIC)
        codes = {axis["code"] for axis in axes}
        self.assertEqual(len(axis_rows(links, questions, codes, REVIEW)), len(links))
        # 參照點都有四軸位置
        self.assertEqual(len(reference_rows(references, codes)), 52)

    @unittest.skipUnless(
        (CACHE_DIR / "8values-questions" / "questions.js").exists(), "原始檔尚未下載"
    )
    def test_matches_original(self):
        """手寫表與原始檔一致，重新組成的內容與發布檔相同。"""
        content = build_dataset(TOPIC, offline=True)
        published = read_json(topic_product_path(TOPIC))
        self.assertEqual(content["questions"], published["questions"])
        # 授權全文取自原始檔
        self.assertIn("MIT License", content["license"])

    @unittest.skipUnless(
        (CACHE_DIR / "mac-routine-polls" / "routine-polls.csv").exists(),
        "原始檔尚未下載",
    )
    def test_choice_comparisons(self):
        """兩岸立場的單選題有選項，統獨題附最新一期的比例，認同題只附連結。"""
        content = build_dataset(CHOICE_TOPIC, offline=True)
        by_id = by_code(content["questions"], "id")
        self.assertEqual(len(by_id["q1-tondu"]["options"]), 6)
        # 量尺題沒有選項
        self.assertIsNone(by_id["q3-independence"]["options"])
        tondu, identity = content["comparisons"]
        # 六個選項加無反應約為 1，四捨五入的誤差在千分之五以內
        self.assertAlmostEqual(
            sum(tondu["shares"].values()) + tondu["none"], 1, delta=0.005
        )
        self.assertIsNone(identity["shares"])
        # 對照的來源列在資料集的來源
        self.assertEqual(
            [source["id"] for source in content["sources"]], ["mac-routine-polls"]
        )

    def test_index_lists_topic(self):
        """索引的主題測驗附帶 kind、卡片與資料集位置，選舉也附帶 kind。"""
        index = read_json(INDEX_PATH)
        # 選取 8values 那一筆
        entry = next(item for item in index["topics"] if item["id"] == TOPIC)
        self.assertEqual(entry["kind"], "topic")
        self.assertIn("topic.radar", entry["cards"])
        # 資料集位置在發布階段的 topics 目錄
        self.assertTrue(entry["dataset"].endswith(f"topics/{TOPIC}/dataset.json"))
        # 選舉的每一筆也附帶 kind
        self.assertTrue(all(item["kind"] == "election" for item in index["elections"]))

    def test_topic_sources_stay_in_topic(self):
        """主題測驗的原始檔登錄在題組自己的設定，代碼不與 sources.yaml 重複。"""
        # 各自讀取自己的來源，代碼與 sources.yaml 重複時 topic_sources 會拋出錯誤
        self.assertEqual(
            sorted(topic_sources(topic_config(TOPIC))),
            ["8values-ideologies", "8values-license", "8values-questions"],
        )
        self.assertEqual(
            sorted(topic_sources(topic_config(CHOICE_TOPIC))), ["mac-routine-polls"]
        )

    def test_exploratory_axes_balanced(self):
        """台灣地位詮釋的每條軸都有同意與反對兩個方向的題目。"""
        questions, links, references = read_authored(STATUS_TOPIC)
        directions = {}
        # 依軸收集方向
        for row in links:
            directions.setdefault(row["軸"], set()).add(row["方向"])
        self.assertEqual(
            directions,
            {axis: {"1", "-1"} for axis in ("sovereignty", "relation", "basis")},
        )
        # 探索性題組沒有參照點，共 14 題
        self.assertEqual(references, [])
        self.assertEqual(len(questions), 14)

    def test_bad_rows_fail(self):
        """方向、缺軸對應、軸對應指向單選題、只有一個選項與位置寫法錯誤時失敗。"""
        questions, links, references = read_authored(TOPIC)
        codes = {"econ", "dipl", "govt", "scty"}
        # 方向只能是 1 或 -1
        with self.assertRaisesRegex(PipelineError, "方向"):
            axis_rows([links[0] | {"方向": "2"}], questions, codes, REVIEW)
        # 有量尺題沒有任何軸對應
        with self.assertRaisesRegex(PipelineError, "沒有涵蓋量尺題"):
            # 移除 q01 的全部軸對應
            axis_rows(
                [row for row in links if row["題目"] != "q01"], questions, codes, REVIEW
            )
        # 位置少一條軸
        with self.assertRaisesRegex(PipelineError, "剛好寫出"):
            reference_rows([references[0] | {"位置": "econ=50"}], codes)
        # 位置缺等號
        with self.assertRaisesRegex(PipelineError, "軸=位置"):
            reference_rows([references[0] | {"位置": "econ50"}], codes)
        choice_questions, choice_links, _ = read_authored(CHOICE_TOPIC)
        # 單選題不進軸
        with self.assertRaisesRegex(PipelineError, "題目或軸未登錄"):
            axis_rows(
                [*choice_links, choice_links[0] | {"代碼": "x", "題目": "q1-tondu"}],
                choice_questions,
                {"independence", "unification"},
                REVIEW,
            )
        # 一題只有一個選項時無從選擇
        with self.assertRaisesRegex(PipelineError, "只有一個選項"):
            option_rows([{"代碼": "a", "題目": "q1-tondu", "名稱": "甲"}], {"q1-tondu"})
