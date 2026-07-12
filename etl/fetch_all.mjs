// 從中選會選舉資料庫（公開靜態 JSON）抓「全臺 22 縣市」所有區/里、三屆里長得票，
// 全部用中選會官方數字（含官方選舉人數 votable_population）。
// 縣市清單直接從中選會 API 動態取得（官方法定順序），不再手動維護。
//
// 輸出（前端按需載入，避免全臺資料打包進 bundle）：
//   public/data/index.json          — 縣市清單 + meta（首屏只載這個，約 2KB）
//   public/data/county/<code>.json  — 各縣市完整里資料（選了縣市才載）
//
// 用法：node etl/fetch_all.mjs   （Node 18+ 內建 fetch）

import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'data');
const BASE = 'https://db.cec.gov.tw/static/elections/data';

const ELECTIONS = [
  { year: 2022, themeId: '0bd11a4b3f092aae2811741428ec3e3d' },
  { year: 2018, themeId: '80325f73197f1d752b987778c725d20d' },
  { year: 2014, themeId: 'f29f60196b2b39ef6ac298106f927738' },
];

async function getJson(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return await res.json();
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

function partyToken(name = '') {
  if (name.includes('國民黨')) return 'KMT';
  if (name.includes('民主進步')) return 'DPP';
  if (name.includes('民眾黨')) return 'TPP';
  if (name.includes('時代力量')) return 'NPP';
  if (name.includes('親民黨')) return 'PFP';
  if (name.includes('無黨') || name.includes('未經政黨')) return 'IND';
  return name || 'IND';
}

const flat = (obj) => Object.values(obj).flat();
const vkey = (r) => `${r.dept_code}_${r.li_code}`;

// 中選會官方縣市清單（回傳順序即官方法定順序：直轄市→縣→市）
async function fetchCounties() {
  const rows = flat(await getJson(`${BASE}/areas/ELC/V0/00/${ELECTIONS[0].themeId}/C/00_000_00_000_0000.json`));
  return rows.map((r) => ({
    name: r.area_name,
    code: `${r.prv_code}${r.city_code}`, // 例：臺中市 66000、彰化縣 10007
    file: `${r.prv_code}_${r.city_code}_00_000_0000.json`,
  }));
}

async function fetchCounty(county) {
  // 區/鄉鎮 代碼 → 名稱
  const areasD = await getJson(`${BASE}/areas/ELC/V0/00/${ELECTIONS[0].themeId}/D/${county.file}`);
  const deptName = {};
  for (const a of flat(areasD)) deptName[a.dept_code] = a.area_name;

  // 各屆：里 → 結果（tickets 與 profiles 並行抓）
  const perYear = {};
  for (const e of ELECTIONS) {
    const [tickets, profiles] = await Promise.all([
      getJson(`${BASE}/tickets/ELC/V0/00/${e.themeId}/L/${county.file}`).then(flat),
      getJson(`${BASE}/profiles/ELC/V0/00/${e.themeId}/L/${county.file}`).then(flat),
    ]);
    const prof = {};
    for (const p of profiles) prof[vkey(p)] = p;

    const byV = {};
    for (const t of tickets) {
      (byV[vkey(t)] ??= { dept: t.dept_code, li: t.li_code, name: t.area_name, cands: [] }).cands.push({
        name: t.cand_name,
        votes: t.ticket_num,
        won: String(t.is_victor).trim() === '*',
        party: partyToken(t.party_name),
        birthYear: Number(t.cand_birthyear) || undefined,
      });
    }
    const yr = {};
    for (const [k, v] of Object.entries(byV)) {
      const p = prof[k];
      v.cands.sort((a, b) => b.votes - a.votes);
      yr[k] = {
        dept: v.dept,
        li: v.li,
        villageName: v.name,
        result: {
          year: e.year,
          electorate: p?.votable_population || undefined,
          turnout: p?.vote_to_elect != null ? Math.round(p.vote_to_elect * 100) / 10000 : undefined,
          valid_votes: p?.valid_ticket ?? undefined,
          candidates: v.cands,
          uncontested: (p?.cand_num ?? v.cands.length) === 1,
        },
      };
    }
    perYear[e.year] = yr;
  }

  // 合併各屆（以所有里 key 聯集，最新一屆當基準）
  const keys = new Set();
  for (const e of ELECTIONS) for (const k of Object.keys(perYear[e.year])) keys.add(k);

  const villages = [];
  for (const k of keys) {
    const history = [];
    let base;
    for (const e of ELECTIONS) {
      const cell = perYear[e.year][k];
      if (!cell) continue;
      if (!base) base = cell;
      history.push(cell.result);
    }
    if (!base) continue;
    const electorate = history.find((h) => h.electorate)?.electorate;
    villages.push({
      county: county.name,
      district: deptName[base.dept] ?? base.dept,
      village: base.villageName,
      region_code: `${county.code}_${base.dept}_${base.li}`,
      pop_eligible_est: electorate ?? 0,
      history,
    });
  }
  // 照行政區代碼排（dept→li 皆零補位定寬），= 官方法定行政區順序
  villages.sort((a, b) => a.region_code.localeCompare(b.region_code));
  return villages;
}

async function main() {
  const counties = await fetchCounties();
  console.log(`中選會縣市清單：${counties.length} 個\n`);

  mkdirSync(join(OUT_DIR, 'county'), { recursive: true });

  const index = [];
  let total = 0;
  for (const c of counties) {
    process.stdout.write(`抓 ${c.name}（${c.code}）… `);
    const villages = await fetchCounty(c);
    console.log(`${villages.length} 個里`);
    writeFileSync(join(OUT_DIR, 'county', `${c.code}.json`), JSON.stringify({ county: c.name, villages }), 'utf8');
    index.push({ code: c.code, name: c.name, villages: villages.length });
    total += villages.length;
  }

  const out = {
    meta: {
      scope: `全臺 ${counties.length} 縣市，共 ${total.toLocaleString('zh-TW')} 個村里`,
      election_source: '中央選舉委員會 選舉資料庫（2014/2018/2022 村里長選舉）',
      electorate_note: '選舉人數＝中選會最近一屆官方數字；退保證金門檻＝選舉人數 × 10%（《選罷法》）。',
      generated_at: new Date().toISOString().slice(0, 10),
    },
    counties: index,
  };
  writeFileSync(join(OUT_DIR, 'index.json'), JSON.stringify(out), 'utf8');
  console.log(`\n總計 ${total} 個里 → ${OUT_DIR}`);
}

main().catch((e) => {
  console.error('失敗：', e.message);
  process.exit(1);
});
