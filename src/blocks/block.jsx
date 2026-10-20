/* ==================================================
 * blocks/block.jsx - 區塊登錄表
 * --------------------------------------------------
 * - 角色：依區塊描述的 type 找到對應的元件並繪製。卡片、視窗與巢狀的區塊，一串區塊經由 Blocks、單一區塊經由 Block 繪製
 * - 指令：import { Block, Blocks } from "./block.jsx"，由 shell.jsx 的外框與視窗使用
 * - 慣例：
 *   - 卡片描述引用了未登錄的 type 時直接拋出錯誤，避免畫面默默缺一塊
 *   - 每個區塊元件收 spec、Block 與 Blocks 屬性，要畫子區塊的元件用傳入的元件，各區塊模組不必反向匯入本檔
 *   - 一串區塊的 key 是「type:同型別中的序號」，描述寫了 key 時以它為準。前面的選填區塊出現或消失時，後面的區塊沿用同一組元素
 * ================================================== */

import * as basic from "./basic.jsx";
import * as inputs from "./inputs.jsx";
import * as charts from "./charts.jsx";
import * as flow from "./flow.jsx";
import * as ranking from "./ranking.jsx";
import { DistrictMap } from "./map.jsx";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 區塊類型對應元件，鍵與卡片描述的 type 相同。
 */
const BLOCKS = {
  text: basic.TextBlock,
  heading: basic.Heading,
  hero: basic.Hero,
  buttons: basic.Buttons,
  stats: basic.Stats,
  list: basic.List,
  entries: basic.Entries,
  steps: basic.Steps,
  table: basic.Table,
  notice: basic.Notice,
  keyValue: basic.KeyValue,
  tabs: basic.Tabs,
  pager: basic.Pager,
  search: basic.Search,
  claim: basic.Claim,
  image: basic.Image,
  group: basic.Group,
  details: basic.Details,
  faq: basic.Faq,
  timeline: basic.Timeline,
  formulas: basic.Formulas,
  progress: basic.Progress,
  topic: flow.Topic,
  question: flow.Question,
  numbers: flow.Numbers,
  legend: basic.Legend,
  copy: basic.Copy,
  ranking: ranking.Ranking,
  candidateBar: ranking.CandidateBar,
  candidatePicker: ranking.CandidatePicker,
  importance: flow.Importance,
  scale: inputs.Scale,
  choice: inputs.Choice,
  segmented: inputs.Segmented,
  slider: inputs.Slider,
  toggle: inputs.Toggle,
  select: inputs.Select,
  checks: inputs.Checks,
  bars: charts.Bars,
  spectrum: charts.Spectrum,
  radar: charts.Radar,
  heatmap: charts.Heatmap,
  sankey: charts.Sankey,
  treemap: charts.Treemap,
  histogram: charts.Histogram,
  map: DistrictMap,
};

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 繪製一個區塊。Block 與 Blocks 互相引用，巢狀的區塊由兩者遞迴繪製。
 * @param {{ spec: { type: string } }} props spec 是區塊描述，type 決定用哪個元件。
 * @returns {JSX.Element}
 */
function Block({ spec }) {
  const Draw = BLOCKS[spec.type];
  // 未登錄的區塊類型是程式錯誤
  if (!Draw) throw new Error(`沒有登錄區塊類型 ${spec.type}`);
  return <Draw spec={spec} Block={Block} Blocks={Blocks} />;
}

/**
 * 繪製一串區塊，略過 null，依型別與同型別中的序號指定 key。
 * @param {{ specs: ({ type: string, key?: string }|null)[] }} props specs 是區塊描述，選填的區塊以 null 占位。key 是選填的穩定代碼，內容換成另一筆資料時用它讓元素整個重新掛載。
 * @returns {JSX.Element[]}
 */
function Blocks({ specs }) {
  const seen = new Map();
  // 每種型別各自計數，其他型別的區塊出現或消失不影響這一型別的序號
  return specs.filter(Boolean).map((spec) => {
    const index = seen.get(spec.type) ?? 0;
    seen.set(spec.type, index + 1);
    return <Block key={spec.key ?? `${spec.type}:${index}`} spec={spec} />;
  });
}

/* ==================================================
 * 匯出
 * ================================================== */

export { Block, Blocks };
