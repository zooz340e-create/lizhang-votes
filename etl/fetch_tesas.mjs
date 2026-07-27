// TESAS（國發會地方創生資料庫）村里年齡結構 → 烘焙進計算機靜態資料
//
// 架構決策（2026-07-27）：TESAS 有 Cloudflare bot 防護，伺服器直連 403、
// 瀏覽器跨域也不可行 → 一律「ETL 烘焙制」：本腳本經 Firecrawl 代理抓取，
// 產出 public/data/demo/<countyCode>.json，前端按需載入、永不直打 TESAS。
//
// 顆粒度：村里級僅人口三支（Pop/PopChange/PopStruct）；教育/經濟/觀光為鄉鎮級。
// 已知資料庫怪癖：year 欄位不可信（110Y 的 id 其 year 欄寫 109）→ 以 id 前綴過濾。
//
// 用法：FIRECRAWL_API_KEY=<key> node etl/fetch_tesas.mjs [countyCode=10007]
// 資料年份：110 年（TESAS 目前最新）。SEGIS 之後有村里年齡 oCode 可換更新源。

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COUNTY = process.argv[2] ?? '10007'; // 預設彰化縣（MVP 試營運）
const YEAR = '110';
const KEY = process.env.FIRECRAWL_API_KEY;
if (!KEY) { console.error('需要 FIRECRAWL_API_KEY（TESAS 擋伺服器直連）'); process.exit(1); }

async function viaFirecrawl(url) {
  const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, formats: ['rawHtml'] }),
  });
  if (!res.ok) throw new Error(`firecrawl HTTP ${res.status}`);
  const j = await res.json();
  const raw = j.data?.rawHtml ?? '';
  const m = raw.match(/\{"value":\[[\s\S]*\]\}/);
  return JSON.parse(m ? m[0] : raw).value;
}

async function main() {
  const base = 'https://tesas.ndc.gov.tw/tesas_api/odata/v1/VillagePopStruct';
  const filter = encodeURIComponent(`startswith(id,'PopStruct_${YEAR}Y${COUNTY}')`);
  let all = [];
  for (let skip = 0; ; skip += 500) {
    process.stdout.write(`抓第 ${skip / 500 + 1} 頁… `);
    const rows = await viaFirecrawl(`${base}?$filter=${filter}&$top=500&$skip=${skip}`);
    console.log(`${rows.length} 筆`);
    all = all.concat(rows);
    if (rows.length < 500) break;
  }

  // 依鄉鎮+里名 keyed（前端用 district+village 對回；四捨五入減檔案體積）
  const r1 = (n) => Math.round(n * 10) / 10;
  const villages = {};
  for (const r of all) {
    villages[`${r.town_o}|${r.village_o}`] = {
      y: Number(YEAR),
      young: r.a0a14_cnt, work: r.a15a64_cnt, old: r.a65up_cnt,
      young_p: r1(r.a0a14_per), work_p: r1(r.a15a64_per), old_p: r1(r.a65up_per),
      aging: r1(r.a65_a0a14_rat), // 老化指數 = 老年/幼年 ×100
    };
  }

  const outDir = join(__dirname, '..', 'public', 'data', 'demo');
  mkdirSync(outDir, { recursive: true });
  const meta = {
    source: '國發會 TESAS 地方創生資料庫（VillagePopStruct）',
    year_roc: Number(YEAR),
    note: '三段年齡結構與老化指數；村里級最新為 110 年，僅供趨勢參考',
  };
  writeFileSync(join(outDir, `${COUNTY.padEnd(5, '0')}.json`), JSON.stringify({ meta, villages }), 'utf8');
  console.log(`完成：${all.length} 個村里 → public/data/demo/${COUNTY.padEnd(5, '0')}.json`);
}

main().catch((e) => { console.error('失敗：', e.message); process.exit(1); });
