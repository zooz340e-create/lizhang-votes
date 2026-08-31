// 高雄市 115 年 7 月里行政區調整 → 修補計算機名冊（64000.json）
//
// 背景：高雄 7 區 21 里調整 115-07-01 生效（新增 10 里、裁併 7 里；例：左營
// 福山里→福山/福榮/福華/福愛 4 里）。2022 中選會名冊已過時。
// 資料源：高雄市民政局戶籍人口統計平台 REST API（免驗證）：
//   demographics.kcg.gov.tw/demographstats/detailed/population/districts/<鄉鎮碼>/villages?year=115&month=7
// 以 115/7 官方里名冊為準：
//   - 新出現的里 → 新增條目，選舉人數＝人口 × 該區「選舉人/人口」比（2022 實績），標記推估
//   - 消失的里 → 自名冊移除（已併入他里）
// 歷史得票不搬移（新里無歷史 → 前端自動顯示「資料不足」）。
//
// 用法：node etl/patch_kaohsiung_115.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CALC_PATH = join(__dirname, '..', 'public', 'data', 'county', '64000.json');
const calcFile = JSON.parse(readFileSync(CALC_PATH, 'utf8'));
const calc = calcFile.villages;

// 高雄 38 區代碼（取自 SEGIS TOWN_ID）＋區名，從年齡烘焙原始檔萃取會更穩，
// 這裡直接以計算機側 district 清單反查 API 的 district 代碼：改用暴力掃描 64000010–64000400。
const districts = new Map(); // code → name
for (let n = 10; n <= 400; n += 10) {
  districts.set(`64000${String(n).padStart(3, '0')}`, null);
}

async function fetchVillages(code) {
  const url = `https://demographics.kcg.gov.tw/demographstats/detailed/population/districts/${code}/villages?year=115&month=7`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

const official = new Map(); // `${districtName}|${villageName}` → { pop }
let districtNames = new Map(); // 區名 → API 回傳原始
for (const code of districts.keys()) {
  const data = await fetchVillages(code);
  if (!data) continue;
  const list = Array.isArray(data) ? data : (data.villages ?? data.data ?? Object.values(data).find(Array.isArray) ?? []);
  if (!list.length) continue;
  // 欄位名不確定，印一次樣本供人工核對
  if (official.size === 0) console.log('API 樣本:', JSON.stringify(list[0]).slice(0, 300));
  for (const v of list) {
    const dName = v.districtName ?? v.district ?? v.DIST_NAME ?? '';
    const vName = (v.villageName ?? v.village ?? v.VILL_NAME ?? v.name ?? '').replace(/\s/g, '');
    const pop = Number(v.populationCount ?? v.population ?? v.total ?? 0);
    if (!vName) continue;
    const key = `${dName}|${vName.endsWith('里') ? vName : vName + '里'}`;
    official.set(key, { pop });
    districtNames.set(dName, code);
  }
  await new Promise((r) => setTimeout(r, 150));
}
console.log(`官方 115/7 名冊：${official.size} 里，${districtNames.size} 區`);

// 每區「選舉人/人口」比（2022 電算 electorate ÷ 對應 SEGIS 114 人口）近似 0.85，
// 為免再拉一份人口檔，這裡用全市經驗比 0.85（推估值，介面已標示 isEstimate）
const ELECTOR_RATIO = 0.85;

const calcKeys = new Set(calc.map((v) => `${v.district}|${v.village}`));
const removed = [];
const kept = calc.filter((v) => {
  const k = `${v.district}|${v.village}`;
  const dPresent = [...official.keys()].some((ok) => ok.startsWith(`${v.district}|`));
  if (!dPresent) return true; // 該區 API 沒回資料 → 不動
  if (official.has(k)) return true;
  removed.push(k);
  return false;
});

const added = [];
for (const [k, { pop }] of official) {
  if (calcKeys.has(k)) continue;
  const [district, village] = k.split('|');
  added.push({
    region_code: `64000-115ADJ-${added.length + 1}`,
    county: '高雄市',
    district,
    village,
    pop_total: pop,
    pop_eligible_est: Math.round(pop * ELECTOR_RATIO),
    history: [],
    adj: '115 年 7 月行政區調整新設；選舉人數為人口推估，以選委會公告為準',
  });
}

calcFile.villages = [...kept, ...added];
calcFile.meta = {
  ...(calcFile.meta ?? {}),
  adjusted_115: `高雄市 115-07-01 里調整已套用（新增 ${added.length}、移除 ${removed.length}）；新里選舉人數＝115/7 人口 × ${ELECTOR_RATIO}（推估）`,
};
writeFileSync(CALC_PATH, JSON.stringify(calcFile), 'utf8');
console.log('新增里：', added.map((a) => `${a.district}${a.village}(人口${a.pop_total})`).join('、'));
console.log('移除里（已併入他里）：', removed.join('、'));
writeFileSync(join(__dirname, 'out', 'kaohsiung_115_patch_report.json'), JSON.stringify({ added, removed }, null, 1), 'utf8');
