// 基準定位資料烘焙 — ⑤ 卡「這個里在全臺的位置」
//
// 兩個官方源 → public/data/base/<縣市碼>.json（不寫進 demo 檔：ris_reconcile 每月整檔重寫 demo）
//   1. 大專以上比例：內政部戶政司 rs-opendata ODRP020（15 歲以上教育程度，村里，年檔）
//      口徑＝（專科＋大學＋碩士＋博士）畢業 ÷ 15 歲以上人口，不含肄業
//   2. 所得中位數：財政部財資中心 165-9 表（綜稅綜合所得總額，村里，年度）
//      口徑＝每納稅單位（戶）綜合所得總額中位數，千元；不是個人薪資
//   3. 老化指數：直接讀現成 demo 檔（ODRP014），只拿來算全臺分位與同區基準
//
// 115 年行政區調整里（county 檔有 adj）一律不給值：兩個源都早於調整生效日，範圍對不上。
//
// 用法：node etl/bake_baseline.mjs [教育民國年=114] [所得年度=112]
//   （優先讀 /tmp/odrp020_<年>.json、/tmp/fia165_<年>.csv 快取）

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EDU_Y = process.argv[2] ?? '114';
const INC_Y = process.argv[3] ?? '112';
const UA = { 'User-Agent': 'Mozilla/5.0' };

// ── 取得原始資料 ──────────────────────────────────────────
async function getEdu() {
  const cache = `/tmp/odrp020_${EDU_Y}.json`;
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, 'utf8'));
  let rows = [];
  for (let p = 1; ; p++) {
    const j = await (await fetch(`https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP020/${EDU_Y}?page=${p}`, { headers: UA })).json();
    // 查無資料時 HTTP 仍 200、沒有 responseData（ris_reconcile 的教訓），要擋住免得空轉
    if (!j.responseData) throw new Error(`ODRP020/${EDU_Y} 查無資料：${j.responseMessage}`);
    rows = rows.concat(j.responseData);
    console.log(`ODRP020 第 ${p}/${j.totalPage} 頁…累計 ${rows.length}`);
    if (p >= Number(j.totalPage)) break;
  }
  writeFileSync(cache, JSON.stringify(rows));
  return rows;
}
async function getInc() {
  const cache = `/tmp/fia165_${INC_Y}.csv`;
  if (existsSync(cache)) return readFileSync(cache, 'utf8');
  const res = await fetch(`https://www.fia.gov.tw/WEB/fia/ias/ias${INC_Y}/${INC_Y}_165-9.csv`, { headers: UA });
  if (!res.ok) throw new Error(`財資中心 ${INC_Y} 年度 HTTP ${res.status}`);
  const txt = await res.text();
  writeFileSync(cache, txt);
  return txt;
}

// ── 罕字雙向容錯比對（ris_reconcile.mjs 那套，再多吃財資中心的異體字）──────────────
const VARIANTS = [['舘', '館'], ['脚', '腳'], ['双', '雙'], ['墻', '牆'], ['鷄', '雞'], ['濓', '濂'], ['峯', '峰'], ['臺', '台'], ['壳', '売'], ['𦰡', '那'], ['𣐤', '瓊'], ['豊', '豐'],
  // 財資中心 165-9 表才有的拼法（2026-09-26 實證）：七股塩埕、安南塩田、馬公啟明
  ['𥂁', '塩'], ['啓', '啟']];
// NFC：中選會名冊用 CJK 相容表意字（西港檨林里 U+2F8EB），正規化後才等於正字
const normVariant = (s) => VARIANTS.reduce((acc, [a, b]) => acc.split(a).join(b), s.normalize('NFC'));
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

// ── 整理：以正規化「縣市區」分桶 ────────────────────────────
const r1 = (n) => Math.round(n * 10) / 10;
const EDU_KEYS = ['doctor', 'master', 'university', 'juniorcollege_2ys', 'juniorcollege_5ys_final2y'];
const eduRows = (await getEdu()).map((r) => {
  const g = (k) => Number(r[`edu_${k}_graduated_m`] ?? 0) + Number(r[`edu_${k}_graduated_f`] ?? 0);
  return { cd: normVariant(r.site_id), village: r.village, hi: EDU_KEYS.reduce((s, k) => s + g(k), 0), base: Number(r.edu_age_15up_total) };
});
const incRows = [];
const incDistrict = new Map(); // 正規化縣市區 → 合計列中位數
for (const line of (await getInc()).replace(/^﻿/, '').split(/\r?\n/).slice(1)) {
  if (!line.trim()) continue;
  const c = line.split('","').map((s) => s.replace(/^﻿|"/g, ''));
  const [cd, village, n, , , med, q1, q3] = c;
  if (village === '合計') incDistrict.set(normVariant(cd), Number(med));
  else if (village !== '其他' && Number(n) > 0) incRows.push({ cd: normVariant(cd), village, n: Number(n), med: Number(med), q1: Number(q1), q3: Number(q3) });
}
const bucket = (rows) => {
  const m = new Map();
  for (const r of rows) (m.get(r.cd) ?? m.set(r.cd, []).get(r.cd)).push(r);
  return m;
};
const eduBy = bucket(eduRows);
const incBy = bucket(incRows);

// 同區教育基準：全區里加總（含對不上計算機名冊的里，才是該區真實全貌）
const eduDistrict = new Map();
for (const [cd, rows] of eduBy) {
  const hi = rows.reduce((s, r) => s + r.hi, 0);
  const base = rows.reduce((s, r) => s + r.base, 0);
  if (base > 0) eduDistrict.set(cd, r1((hi / base) * 100));
}

// ── 對帳 ─────────────────────────────────────────────────
const countyDir = join(__dirname, '..', 'public', 'data', 'county');
const demoDir = join(__dirname, '..', 'public', 'data', 'demo');
const outDir = join(__dirname, '..', 'public', 'data', 'base');
mkdirSync(outDir, { recursive: true });

const perCounty = new Map(); // code → { villages, district }
const all = { edu: [], inc: [], aging: [] };
const miss = { edu: [], inc: [] };
let total = 0;

for (const f of readdirSync(countyDir)) {
  const code = f.replace('.json', '');
  const data = JSON.parse(readFileSync(join(countyDir, f), 'utf8'));
  const demoPath = join(demoDir, f);
  const demo = existsSync(demoPath) ? JSON.parse(readFileSync(demoPath, 'utf8')).villages : {};
  const villages = {};
  const district = {};
  const agingAcc = {}; // 區 → { old, young }

  for (const v of data.villages) {
    total++;
    const key = `${v.district}|${v.village}`;
    const cd = normVariant(v.county + v.district);
    const dm = demo[key];
    if (dm && !dm.stale) {
      const a = (agingAcc[v.district] ??= { old: 0, young: 0 });
      a.old += dm.old;
      a.young += dm.young;
      if (!v.adj) all.aging.push(dm.aging);
    }
    district[v.district] ??= { edu_p: eduDistrict.get(cd) ?? null, inc_med: incDistrict.get(cd) ?? null, aging: null };
    if (v.adj) continue; // 調整里：兩個源都是調整前的舊範圍

    const entry = {};
    const e = eduBy.get(cd)?.find((r) => nameEq(v.village, r.village));
    if (e && e.base > 0) {
      entry.edu_p = r1((e.hi / e.base) * 100);
      all.edu.push(entry.edu_p);
    } else miss.edu.push(v.county + key);
    const i = incBy.get(cd)?.find((r) => nameEq(v.village, r.village));
    if (i) {
      Object.assign(entry, { inc_med: i.med, inc_q1: i.q1, inc_q3: i.q3, inc_n: i.n });
      all.inc.push(i.med);
    } else miss.inc.push(v.county + key);
    if (Object.keys(entry).length) villages[key] = entry;
  }
  for (const [d, a] of Object.entries(agingAcc)) if (a.young > 0) district[d].aging = r1((a.old / a.young) * 100);
  perCounty.set(code, { villages, district });
}

// ── 全臺里級百分位（0..100 共 101 點，前端算 PR 與高低切點）───────
function percentiles(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return Array.from({ length: 101 }, (_, p) => s[Math.round((p / 100) * (s.length - 1))]);
}
const pct = { edu: percentiles(all.edu), inc: percentiles(all.inc), aging: percentiles(all.aging) };

for (const [code, { villages, district }] of perCounty) {
  writeFileSync(
    join(outDir, `${code}.json`),
    JSON.stringify({
      meta: {
        edu_source: `內政部戶政司 村里 15 歲以上人口教育程度（ODRP020，民國 ${EDU_Y} 年底）`,
        edu_year: Number(EDU_Y),
        inc_source: `財政部財政資訊中心 綜稅綜合所得總額村里統計（${INC_Y} 年度）`,
        inc_year: Number(INC_Y),
        note: '大專以上＝專科以上畢業÷15歲以上人口；所得＝每納稅單位（戶）綜合所得總額中位數，千元，非個人薪資',
      },
      pct,
      district,
      villages,
    }),
  );
}

console.log(`計算機名冊 ${total} 里｜教育對上 ${all.edu.length}｜所得對上 ${all.inc.length}｜老化 ${all.aging.length}`);
console.log(`全臺里級中位數：大專以上 ${pct.edu[50]}%｜所得 ${pct.inc[50]} 千元｜老化指數 ${pct.aging[50]}`);
console.log(`教育未對上（非 adj）${miss.edu.length}：${miss.edu.join(' ')}`);
console.log(`所得未對上（非 adj）${miss.inc.length}：${miss.inc.join(' ')}`);
