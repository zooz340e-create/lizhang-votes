// 全國村里名冊大對帳 — 內政部戶政司 ODRP014（村里單一年齡人口，逐月）
//
// 這是行政區調整的「終極權威源」：全國、逐月、免驗證、含 0-100 逐歲人口。
// 一次解決三件事（2026-09-02 起取代逐縣市打補丁）：
//   1. 名冊對帳：新設里補進、已裁併里移除（吃下 115/7 全國所有調整）
//   2. 選舉人基礎精算：新設里 pop_eligible_est ＝ 20 歲以上人口「精確數」
//      （取代 ×0.85 推估）；既有 adj 里一併刷新
//   3. demo 檔全量重烘：young/work/old/ta(30-49)/o60/a20 直接從逐歲加總，
//      資料月份新於 SEGIS 年檔（取代 etl/fetch_segis_age.mjs 的資料源）
//
// 罕字教訓（新北案）：計算機側（中選會）用 Unicode 私用區字元，RIS 側用正字
// 或問號——比對兩邊都要容錯，且「刪除」前務必先過容錯比對，方向錯會洗掉歷史。
//
// 用法：node etl/ris_reconcile.mjs [民國年月=11508]
//   （優先讀 /tmp/ris_<YM>.json 快取；無快取自行抓 4 頁 API）

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const YM = process.argv[2] ?? '11508';
const YEAR = Number(YM.slice(0, 3));
const MONTH = Number(YM.slice(3));

// ── 取得 RIS 名冊 ──────────────────────────────────────────
let rows;
const cache = `/tmp/ris_${YM}.json`;
if (existsSync(cache)) {
  rows = JSON.parse(readFileSync(cache, 'utf8'));
  console.log(`讀快取 ${cache}：${rows.length} 筆`);
} else {
  rows = [];
  for (let p = 1; ; p++) {
    const res = await fetch(`https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP014/${YM}?page=${p}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const j = await res.json();
    rows = rows.concat(j.responseData ?? []);
    console.log(`第 ${p}/${j.totalPage} 頁…累計 ${rows.length}`);
    if (p >= Number(j.totalPage)) break;
  }
  writeFileSync(cache, JSON.stringify(rows));
}

// ── 整理：site_id → 縣市(前3字)+區；逐歲加總 ─────────────────
function agg(r) {
  const age = (n) => Number(r[`people_age_${String(n).padStart(3, '0')}_m`] ?? 0) + Number(r[`people_age_${String(n).padStart(3, '0')}_f`] ?? 0);
  const sum = (a, b) => {
    let s = 0;
    for (let i = a; i <= b; i++) s += age(i);
    return s;
  };
  const up100 = Number(r.people_age_100up_m ?? 0) + Number(r.people_age_100up_f ?? 0);
  const young = sum(0, 14);
  const work = sum(15, 64);
  const old = sum(65, 99) + up100;
  return {
    county: r.site_id.slice(0, 3),
    district: r.site_id.slice(3),
    village: r.village,
    pop: Number(r.people_total),
    hh: Number(r.household_no),
    young, work, old,
    a20: sum(20, 99) + up100,
    ta: sum(30, 49),
    o60: sum(60, 99) + up100,
  };
}
const ris = rows.map(agg);
const risByCD = new Map(); // `${county}|${district}` → entry[]
for (const r of ris) {
  const k = `${r.county}|${r.district}`;
  if (!risByCD.has(k)) risByCD.set(k, []);
  risByCD.get(k).push(r);
}

// ── 罕字雙向容錯比對 ──────────────────────────────────────
// 異體字歸一（中選會與戶政司拼法差異，2026-09-01 全國比對實證清單）
const VARIANTS = [['舘', '館'], ['脚', '腳'], ['双', '雙'], ['墻', '牆'], ['鷄', '雞'], ['濓', '濂'], ['峯', '峰'], ['臺', '台'], ['壳', '売'], ['𦰡', '那'], ['𣐤', '瓊'], ['豊', '豐']];
const normVariant = (s) => VARIANTS.reduce((acc, [a, b]) => acc.split(a).join(b), s);

// 私用區含增補平面（戶政司用 Plane 15/16 PUA，中選會用 BMP PUA——新竹/彰化磚磘里實證）
const BROKEN = /\[.\]|[?\u{FFFD}]|[\u{E000}-\u{F8FF}]|[\u{F0000}-\u{FFFFD}]|[\u{100000}-\u{10FFFD}]/gu;
const hasBroken = (s) => { BROKEN.lastIndex = 0; return BROKEN.test(s); };
const toPattern = (s) =>
  new RegExp('^' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(BROKEN, '.') + '$');
function nameEq(rawA, rawB) {
  const a = normVariant(rawA);
  const b = normVariant(rawB);
  if (a === b) return true;
  if (hasBroken(a) && toPattern(a).test(b)) return true;
  if (hasBroken(b) && toPattern(b).test(a)) return true;
  return false;
}

// ── 對帳並套用 ────────────────────────────────────────────
const countyDir = join(__dirname, '..', 'public', 'data', 'county');
const demoDir = join(__dirname, '..', 'public', 'data', 'demo');
mkdirSync(demoDir, { recursive: true });
const r1 = (n) => Math.round(n * 10) / 10;
const report = { added: [], removed: [], refreshed: 0, total: 0 };

for (const f of readdirSync(countyDir)) {
  const code = f.replace('.json', '');
  const path = join(countyDir, f);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const demoVillages = {};
  const matchedRis = new Set();

  const kept = [];
  for (const v of data.villages) {
    const pool = risByCD.get(`${v.county}|${v.district}`);
    const hit = pool?.find((r) => !matchedRis.has(r) && nameEq(v.village, r.village));
    if (hit) {
      matchedRis.add(hit);
      // demo：一律以計算機側名稱為鍵
      const tot = hit.young + hit.work + hit.old;
      if (tot > 0) {
        demoVillages[`${v.district}|${v.village}`] = {
          y: YEAR, m: MONTH,
          young: hit.young, work: hit.work, old: hit.old,
          young_p: r1((hit.young / tot) * 100), work_p: r1((hit.work / tot) * 100), old_p: r1((hit.old / tot) * 100),
          aging: hit.young > 0 ? r1((hit.old / hit.young) * 100) : 0,
          ta: hit.ta, ta_p: r1((hit.ta / tot) * 100),
          o60: hit.o60, o60_p: r1((hit.o60 / tot) * 100),
          a20: hit.a20,
        };
      }
      if (v.adj) {
        // 行政區調整里：以 20 歲以上精確數取代人口×比例推估
        v.pop_total = hit.pop;
        v.pop_eligible_est = hit.a20;
        report.refreshed++;
      }
      kept.push(v);
    } else if (!pool || pool.length === 0) {
      kept.push(v); // 該區 RIS 整區缺席（資料異常防呆）→ 不動
    } else {
      report.removed.push(`${v.county}${v.district}${v.village}`);
    }
  }

  // RIS 有、計算機沒有 → 新設里
  for (const [cd, pool] of risByCD) {
    if (!cd.startsWith(getCountyName(data))) continue;
    for (const r of pool) {
      if (matchedRis.has(r)) continue;
      const tot = r.young + r.work + r.old;
      kept.push({
        region_code: `RIS${YM}-${r.district}-${r.village}`,
        county: r.county,
        district: r.district,
        village: r.village,
        pop_total: r.pop,
        pop_eligible_est: r.a20,
        history: [],
        adj: `115 年行政區調整新設；選舉人數＝${YEAR}/${MONTH} 20 歲以上人口精確數，正式以選委會公告為準`,
      });
      if (tot > 0) {
        demoVillages[`${r.district}|${r.village}`] = {
          y: YEAR, m: MONTH,
          young: r.young, work: r.work, old: r.old,
          young_p: r1((r.young / tot) * 100), work_p: r1((r.work / tot) * 100), old_p: r1((r.old / tot) * 100),
          aging: r.young > 0 ? r1((r.old / r.young) * 100) : 0,
          ta: r.ta, ta_p: r1((r.ta / tot) * 100),
          o60: r.o60, o60_p: r1((r.o60 / tot) * 100),
          a20: r.a20,
        };
      }
      matchedRis.add(r);
      report.added.push(`${r.county}${r.district}${r.village}(20歲+ ${r.a20})`);
    }
  }

  data.villages = kept;
  report.total += kept.length;
  writeFileSync(path, JSON.stringify(data), 'utf8');
  writeFileSync(
    join(demoDir, `${code}.json`),
    JSON.stringify({
      meta: {
        source: `內政部戶政司 村里單一年齡人口統計（ODRP014）`,
        year_roc: YEAR,
        month: MONTH,
        note: `民國 ${YEAR} 年 ${MONTH} 月；三段年齡、老化指數、30-49 主力TA、60+、20 歲以上（選舉人基礎）`,
      },
      villages: demoVillages,
    }),
    'utf8',
  );
}

function getCountyName(data) {
  return data.villages[0]?.county ?? '';
}

// index.json 縣市里數同步
const indexPath = join(__dirname, '..', 'public', 'data', 'index.json');
const index = JSON.parse(readFileSync(indexPath, 'utf8'));
for (const c of index.counties) {
  const d = JSON.parse(readFileSync(join(countyDir, `${c.code}.json`), 'utf8'));
  c.villages = d.villages.length;
}
index.meta.generated_at = new Date().toISOString().slice(0, 10) + ` (RIS ${YEAR}/${MONTH} 對帳)`;
writeFileSync(indexPath, JSON.stringify(index), 'utf8');

console.log(`\n=== 對帳完成（${YEAR}/${MONTH}）===`);
console.log(`新增 ${report.added.length} 里：\n  ${report.added.join('\n  ') || '（無）'}`);
console.log(`移除 ${report.removed.length} 里（已裁併）：\n  ${report.removed.join('\n  ') || '（無）'}`);
console.log(`調整里人口刷新：${report.refreshed}；全國總里數：${report.total}`);
writeFileSync(join(__dirname, 'out', `ris_reconcile_${YM}_report.json`), JSON.stringify(report, null, 1), 'utf8');
