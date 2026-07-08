// 從中選會選舉資料庫（公開靜態 JSON）抓「臺中市 + 彰化縣」所有區/里、三屆里長得票，
// 全部用中選會官方數字（含官方選舉人數 votable_population），輸出 src/data/villages.json。
// 用法：node etl/fetch_all.mjs   （Node 18+ 內建 fetch）

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'src', 'data', 'villages.json');
const BASE = 'https://db.cec.gov.tw/static/elections/data';

// Beta 範圍：臺中市 + 彰化縣 + 宜蘭縣
const COUNTIES = [
  { name: '臺中市', file: '66_000_00_000_0000.json' },
  { name: '彰化縣', file: '10_007_00_000_0000.json' },
  { name: '宜蘭縣', file: '10_002_00_000_0000.json' },
];
const ELECTIONS = [
  { year: 2022, themeId: '0bd11a4b3f092aae2811741428ec3e3d' },
  { year: 2018, themeId: '80325f73197f1d752b987778c725d20d' },
  { year: 2014, themeId: 'f29f60196b2b39ef6ac298106f927738' },
];

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
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

async function fetchCounty(county) {
  // 區/鄉鎮 代碼 → 名稱
  const areasD = await getJson(`${BASE}/areas/ELC/V0/00/${ELECTIONS[0].themeId}/D/${county.file}`);
  const deptName = {};
  for (const a of flat(areasD)) deptName[a.dept_code] = a.area_name;

  // 各屆：里 → 結果
  const perYear = {};
  for (const e of ELECTIONS) {
    const tickets = flat(await getJson(`${BASE}/tickets/ELC/V0/00/${e.themeId}/L/${county.file}`));
    const profiles = flat(await getJson(`${BASE}/profiles/ELC/V0/00/${e.themeId}/L/${county.file}`));
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
      region_code: `${county.file.slice(0, 6).replace('_', '')}_${base.dept}_${base.li}`,
      pop_eligible_est: electorate ?? 0,
      history,
    });
  }
  // 照行政區代碼排（dept→li 皆零補位定寬），= 官方法定行政區順序
  villages.sort((a, b) => a.region_code.localeCompare(b.region_code));
  return villages;
}

async function main() {
  let all = [];
  for (const c of COUNTIES) {
    process.stdout.write(`抓 ${c.name}… `);
    const vs = await fetchCounty(c);
    console.log(`${vs.length} 個里`);
    all = all.concat(vs);
  }
  const out = {
    meta: {
      scope: 'Beta：臺中市 + 彰化縣 + 宜蘭縣',
      election_source: '中央選舉委員會 選舉資料庫（2014/2018/2022 村里長選舉）',
      electorate_note: '選舉人數＝中選會最近一屆官方數字；退保證金門檻＝選舉人數 × 10%（《選罷法》）。',
    },
    villages: all,
  };
  writeFileSync(OUT, JSON.stringify(out), 'utf8');
  console.log(`\n總計 ${all.length} 個里 → ${OUT}`);
}

main().catch((e) => {
  console.error('失敗：', e.message);
  process.exit(1);
});
