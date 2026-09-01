// SEGIS 五歲年齡組（村里，全國）→ 烘焙進計算機「這個里的長相」資料
//
// 取代 TESAS 110 年三段年齡資料（2026-09-01 起）：SEGIS 開放服務免驗證、
// 全國一次到手、資料新（114年12月），且五歲組可自由組 TA 區間。
// 端點：GetAdminSTDataForOpenCode?oCode=<碼>（oCode 來自 STATCloud 資料集頁 JSON 鈕）
//
// 罕字問題：SEGIS 名稱有破損字（寶廍里→寶?里）→ 以計算機縣檔名單為準做
// 萬用字元匹配，輸出鍵一律用計算機側的正確名稱。
//
// 用法：node etl/fetch_segis_age.mjs   # 全國 22 縣市一次烘完

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OCODE = 'ECC48479C0B91632E91C5874DF23C60E51A1FBEE829C41DB0FE22FA2B97D4FF92539094FCB65D41BDDE79C332EB9258D';
const YEAR_LABEL = '114年12月';

const raw = await (await fetch(
  'https://segisws.moi.gov.tw/STATWSSTData/OpenService.asmx/GetAdminSTDataForOpenCode?oCode=' + OCODE,
  { headers: { 'User-Agent': 'Mozilla/5.0' } },
)).text();
const m = raw.match(/>(\[[\s\S]*\]|\{[\s\S]*\})</);
const data = JSON.parse(m ? m[1] : raw);
const rows = Array.isArray(data) ? data : (data.RowDataList ?? Object.values(data).find(Array.isArray) ?? []);
console.log(`SEGIS 五歲年齡組：${rows.length} 村里`);

// 五歲組加總小工具
const sum = (r, keys) => keys.reduce((s, k) => s + (Number(r[k]) || 0), 0);
const G5 = (a, b) => `A${a}A${b}_CNT`;
const YOUNG = [G5(0, 4), G5(5, 9), G5(10, 14)];
const WORK = [G5(15, 19), G5(20, 24), G5(25, 29), G5(30, 34), G5(35, 39), G5(40, 44), G5(45, 49), G5(50, 54), G5(55, 59), G5(60, 64)];
const OLD = [G5(65, 69), G5(70, 74), G5(75, 79), G5(80, 84), G5(85, 89), G5(90, 94), G5(95, 99), 'A100UP_5_CNT'];
const TA3049 = [G5(30, 34), G5(35, 39), G5(40, 44), G5(45, 49)];
const O60 = [G5(60, 64), ...OLD];

// 名稱匹配（罕字容錯，與 segis_fetch.mjs 同思路）
// 破損字三態：問號、方括號注記、Unicode 私用區字元（如 廍→U+E02D）
const normName = (s) => s.replace(/\[.\]|[?\u{FFFD}]|[\u{E000}-\u{F8FF}]/gu, '＊');
function matchVillage(segisName, calcNames) {
  const n = normName(segisName);
  if (!n.includes('＊')) return calcNames.includes(segisName) ? segisName : undefined;
  const re = new RegExp('^' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/＊/g, '.') + '$');
  return calcNames.find((c) => re.test(c));
}

// 依縣市分組，逐縣輸出（鍵用計算機側名稱）
const byCounty = new Map();
for (const r of rows) {
  if (!byCounty.has(r.COUNTY_ID)) byCounty.set(r.COUNTY_ID, []);
  byCounty.get(r.COUNTY_ID).push(r);
}

const countyDir = join(__dirname, '..', 'public', 'data', 'county');
const outDir = join(__dirname, '..', 'public', 'data', 'demo');
mkdirSync(outDir, { recursive: true });
const r1 = (n) => Math.round(n * 10) / 10;
let matched = 0, missed = 0;

for (const f of readdirSync(countyDir)) {
  const code = f.replace('.json', '');
  const calc = JSON.parse(readFileSync(join(countyDir, f), 'utf8')).villages;
  const calcByTown = new Map();
  for (const v of calc) {
    if (!calcByTown.has(v.district)) calcByTown.set(v.district, []);
    calcByTown.get(v.district).push(v.village);
  }
  const segisRows = byCounty.get(code) ?? [];
  const villages = {};
  for (const r of segisRows) {
    const names = calcByTown.get(r.TOWN) ?? [];
    const name = matchVillage(r.VILLAGE, names) ?? r.VILLAGE;
    if (names.length && !names.includes(name)) missed++; else matched++;
    const young = sum(r, YOUNG), work = sum(r, WORK), old = sum(r, OLD);
    const ta = sum(r, TA3049), o60 = sum(r, O60);
    const tot = young + work + old;
    const a20 = tot - young - sum(r, [G5(15, 19)]); // 20 歲以上（選舉權年齡）
    if (tot === 0) continue;
    villages[`${r.TOWN}|${name}`] = {
      y: 114,
      young, work, old,
      young_p: r1((young / tot) * 100), work_p: r1((work / tot) * 100), old_p: r1((old / tot) * 100),
      aging: young > 0 ? r1((old / young) * 100) : 0,
      ta: ta, ta_p: r1((ta / tot) * 100), // 30–49 歲（主力 TA）
      o60: o60, o60_p: r1((o60 / tot) * 100), // 60 歲以上
      a20, // 20 歲以上人口（保證金門檻的最新計算基礎）
    };
  }
  const meta = {
    source: '內政部 SEGIS 社會經濟資料服務平台（五歲年齡組性別人口統計_村里）',
    year_roc: 114,
    note: `${YEAR_LABEL}資料；三段年齡、老化指數、30-49 歲主力TA、60 歲以上占比`,
  };
  writeFileSync(join(outDir, `${code}.json`), JSON.stringify({ meta, villages }), 'utf8');
}
console.log(`完成：${byCounty.size} 縣市 → public/data/demo/；名稱匹配 ${matched}、未匹配 ${missed}`);
