// 新北市 115 年 7 月里編組調整 → 修補計算機名冊（65000.json）
//
// 背景：新北 3 區 7 里調整 115-07-01 生效（林口區 17→21 里：南勢里分出力行里、
// 新林里，湖南里分出頭湖里、文湖里；淡水區 42→44 里：崁頂里分出新崁里、新市里；
// 五股區 20→21 里：成泰／成功里調整新增芳洲里）。中選會 2022 名冊與 SEGIS 114/12
// 年齡檔都早於此日，計算機因此查不到力行里等新里，母里的選舉人數也仍是分割前的。
//   ※ 同案還規劃三重減 4 里、瑞芳減 6 里，但至 115/8 官方名冊尚未生效（三重仍 119
//     里、瑞芳仍 34 里），本腳本以官方名冊為準，生效後重跑即自動裁併。
//
// 資料源：新北市政府民政局「新北市各里人口數排行榜」（免驗證，可直接 GET）：
//   https://www.ca.ntpc.gov.tw/home.jsp?id=89bf7bf4d44b18e0&yyyy=115&mm=8&page=1&pagesize=2000
//   欄位：排名／隸屬區／里／鄰數／戶數／男／女／合計。全市合計與同站「人口統計」
//   頁的 29 區總表逐區對得起來（115/8＝1,039 里、4,035,947 人）。
//
// 處理原則（與 patch_kaohsiung_115.mjs 一致）：
//   - 官方有、計算機沒有的里 → 新增，選舉人數＝人口 × 該區成人比（SEGIS a20 推估）
//   - 官方沒有、計算機有的里 → 移除（已併入他里）
//   - 受影響的母里 → 人口與選舉人數改用最新官方人口重算（分割後範圍已縮小）
//   - 受影響的里一律刪掉 demo 檔的年齡條目：SEGIS 114/12 描述的是分割前的舊範圍，
//     留著會讓保證金門檻用到舊里的 20 歲以上人口（南勢里會從約 470 票暴增到 2,400 票）
//   歷史得票不搬移：新里 history 空陣列，母里保留舊里範圍的歷屆結果（UI 有 🆕 註記）。
//
// 用法：node etl/patch_newtaipei_115.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CALC_PATH = join(__dirname, '..', 'public', 'data', 'county', '65000.json');
const DEMO_PATH = join(__dirname, '..', 'public', 'data', 'demo', '65000.json');
const INDEX_PATH = join(__dirname, '..', 'public', 'data', 'index.json');

// 115-07-01 分割案的母里（來源：新北市政府民政局里鄰調整專區、各區公所各里資訊頁）
// 值為母里陣列（芳洲里由成泰、成功兩里各撥一部分：SEGIS 114/12 → 官方 115/8 的人口
// 落差為成泰 -6,683、成功 -809，合計約等於芳洲里的 7,874 人）
const SPLIT_PARENT = {
  '林口區|力行里': ['南勢里'],
  '林口區|新林里': ['南勢里'],
  '林口區|頭湖里': ['湖南里'],
  '林口區|文湖里': ['湖南里'],
  '淡水區|新崁里': ['崁頂里'],
  '淡水區|新市里': ['崁頂里'],
  '五股區|芳洲里': ['成泰里', '成功里'],
};
// 母里 → 分出的子里（用來寫註記）
const PARENT_KIDS = new Map();
for (const [childKey, parents] of Object.entries(SPLIT_PARENT)) {
  const [district, child] = childKey.split('|');
  for (const p of parents) {
    const k = `${district}|${p}`;
    PARENT_KIDS.set(k, [...(PARENT_KIDS.get(k) ?? []), child]);
  }
}

// ── 1. 抓官方最新名冊（自動找最新可用月份）────────────────────────
const RANK_URL = 'https://www.ca.ntpc.gov.tw/home.jsp?id=89bf7bf4d44b18e0';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36';

function parseRank(htmlText) {
  const out = new Map(); // `${區}|${里}` → { pop, households, neighbors }
  const num = (s) => Number(s.replace(/,/g, ''));
  for (const [, tr] of htmlText.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
      m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim(),
    );
    if (tds.length !== 8) continue;
    const [, district, village, neighbors, households, , , total] = tds;
    if (!district.endsWith('區') || !village) continue;
    out.set(`${district}|${village}`, {
      pop: num(total),
      households: num(households),
      neighbors: num(neighbors),
    });
  }
  return out;
}

const now = new Date();
const nowRoc = now.getFullYear() - 1911;
let official = new Map();
let stamp = '';
outer: for (let y = nowRoc; y >= 115; y--) {
  for (let m = y === nowRoc ? now.getMonth() + 1 : 12; m >= (y === 115 ? 7 : 1); m--) {
    const res = await fetch(`${RANK_URL}&yyyy=${y}&mm=${m}&page=1&pagesize=2000`, {
      headers: { 'User-Agent': UA },
    }).catch(() => null);
    if (!res?.ok) continue;
    const parsed = parseRank(await res.text());
    if (parsed.size > 1000) {
      official = parsed;
      stamp = `${y}/${String(m).padStart(2, '0')}`;
      break outer;
    }
  }
}
if (!official.size) throw new Error('民政局排行榜取不到資料（頁面改版或連線失敗）');
const officialPop = [...official.values()].reduce((s, v) => s + v.pop, 0);
console.log(`官方名冊 ${stamp}：${official.size} 里，${officialPop.toLocaleString()} 人`);

// ── 2. 名稱對齊（罕字容錯）────────────────────────────────
// 中選會名冊用 Unicode 私用區字元寫罕字（瓦磘里＝瓦\uE008里、新廍里＝新\uE02D里），
// 民政局頁面則用正字；瑞芳「濂新／濂洞」兩里雙方還各寫成濂／濓異體。不容錯的話這 5 里
// 會被誤判成「官方新增、計算機該刪」，把歷屆得票整批洗掉。
const VARIANTS = { '\u6FD3': '\u6FC2' }; // 濓 → 濂
const canon = (s) => [...s].map((c) => VARIANTS[c] ?? c).join('');
const normName = (s) => canon(s).replace(/\[.\]|[?\u{FFFD}]|[\u{E000}-\u{F8FF}]/gu, '＊');

const calcFile = JSON.parse(readFileSync(CALC_PATH, 'utf8'));
const calc = calcFile.villages;
const namesByDistrict = new Map(); // 區 → 計算機側里名陣列
for (const v of calc) {
  namesByDistrict.set(v.district, [...(namesByDistrict.get(v.district) ?? []), v.village]);
}
// 計算機側罕字里名 → 比對用樣式（＊ 代表破損字，可對到任何一個字）
const wildcardNames = new Map(); // 區 → [{ name, re }]
for (const [district, names] of namesByDistrict) {
  const list = [];
  for (const name of names) {
    const n = normName(name);
    if (!n.includes('＊')) continue;
    const re = new RegExp('^' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/＊/g, '.') + '$');
    list.push({ name, re });
  }
  if (list.length) wildcardNames.set(district, list);
}
// 官方里名 → 計算機側里名（找不到＝真的是新里）
function toCalcName(district, village) {
  const names = namesByDistrict.get(district) ?? [];
  if (names.includes(village)) return village;
  const sameChar = names.find((n) => canon(n) === canon(village)); // 異體字（濓／濂）
  if (sameChar) return sameChar;
  return wildcardNames.get(district)?.find((w) => w.re.test(canon(village)))?.name;
}

// 官方名冊改用計算機側拼法當鍵
const roster = new Map(); // `${區}|${計算機側里名}` → { pop, households, neighbors, officialName }
for (const [key, o] of official) {
  const [district, village] = key.split('|');
  const name = toCalcName(district, village) ?? village;
  roster.set(`${district}|${name}`, { ...o, officialName: village });
}

// ── 3. 選舉人數推估比（20 歲以上人口 ÷ 總人口）──────────────────
// 優先用該里自己的 SEGIS 114/12 結構（分割後年齡結構大致延續），其次用母里的、
// 再其次用全區平均；都沒有才退回全國經驗值 0.85。
const demoFile = JSON.parse(readFileSync(DEMO_PATH, 'utf8'));
const demoRatio = (key) => {
  const d = demoFile.villages[key];
  if (!d?.a20) return undefined;
  const pop = (d.young ?? 0) + (d.work ?? 0) + (d.old ?? 0);
  return pop ? d.a20 / pop : undefined;
};
const districtAcc = new Map();
for (const [key, d] of Object.entries(demoFile.villages)) {
  const district = key.split('|')[0];
  const pop = (d.young ?? 0) + (d.work ?? 0) + (d.old ?? 0);
  if (!d.a20 || !pop) continue;
  const acc = districtAcc.get(district) ?? { a20: 0, pop: 0 };
  acc.a20 += d.a20;
  acc.pop += pop;
  districtAcc.set(district, acc);
}
function adultRatio(district, village) {
  const own = demoRatio(`${district}|${village}`);
  if (own) return own;
  for (const parent of SPLIT_PARENT[`${district}|${village}`] ?? []) {
    const r = demoRatio(`${district}|${parent}`);
    if (r) return r;
  }
  const acc = districtAcc.get(district);
  return acc?.pop ? acc.a20 / acc.pop : 0.85;
}
const estElectorate = (district, village, pop) => Math.round(pop * adultRatio(district, village));

// ── 4. 修補名冊 ──────────────────────────────────────────────
const calcKeys = new Set(calc.map((v) => `${v.district}|${v.village}`));
const touched = [];

// 4a. 母里（範圍縮小）與前次執行加入的調整里 → 以最新人口重算
for (const v of calc) {
  const key = `${v.district}|${v.village}`;
  const kids = PARENT_KIDS.get(key);
  if (!kids && !v.adj) continue;
  const o = roster.get(key);
  if (!o) continue;
  const before = v.pop_eligible_est;
  v.pop_total = o.pop;
  v.pop_eligible_est = estElectorate(v.district, v.village, o.pop);
  if (kids) {
    v.adj = `115 年 7 月行政區調整：本里已分出${kids.join('、')}，選舉人數改以 ${stamp} 戶籍人口推估；歷屆得票為分割前的舊里範圍`;
  }
  touched.push({ key, before, after: v.pop_eligible_est, pop: o.pop });
}

// 4b. 官方有、計算機沒有 → 新增
const added = [];
for (const [key, o] of roster) {
  if (calcKeys.has(key)) continue;
  const [district, village] = key.split('|');
  const parents = SPLIT_PARENT[key];
  added.push({
    region_code: `65000-115ADJ-${added.length + 1}`,
    county: '新北市',
    district,
    village,
    pop_total: o.pop,
    pop_eligible_est: estElectorate(district, village, o.pop),
    history: [],
    adj: `115 年 7 月行政區調整新設${parents ? `（自${parents.join('、')}分出）` : ''}；無現任里長、無歷屆得票，選舉人數為 ${stamp} 戶籍人口推估，正式數字以選委會公告為準`,
  });
}

// 4c. 官方沒有、計算機有 → 已併入他里，移除
const removed = [];
const kept = calc.filter((v) => {
  if (roster.has(`${v.district}|${v.village}`)) return true;
  removed.push(`${v.district}|${v.village}`);
  return false;
});

calcFile.villages = [...kept, ...added];
// 註記寫「現況」而非「本次增減」，重跑才不會被 0 蓋掉
const newlyCreated = calcFile.villages.filter((v) => v.adj?.includes('新設')).length;
const reworked = calcFile.villages.filter((v) => v.adj?.includes('已分出')).length;
calcFile.meta = {
  ...(calcFile.meta ?? {}),
  adjusted_115: `新北市 115-07-01 里編組調整已套用：以民政局 ${stamp} 官方名冊為準共 ${calcFile.villages.length} 里，其中 ${newlyCreated} 里為調整新設、${reworked} 個母里選舉人數重算`,
};
writeFileSync(CALC_PATH, JSON.stringify(calcFile), 'utf8');

// ── 5. demo 年齡檔：受影響的母里標記為過期（SEGIS 114/12 為分割前範圍）──
// 不刪除：這些數字是新里選舉人數推估比的來源，也留著備查；但打上 stale 後前端
// 不會拿去算門檻或畫年齡卡（留著會讓南勢里門檻從約 520 票暴增到 2,400 票）。
const staled = [];
for (const key of PARENT_KIDS.keys()) {
  const entry = demoFile.villages[key];
  if (entry && !entry.stale) {
    entry.stale = true;
    staled.push(key);
  }
}
demoFile.meta = {
  ...demoFile.meta,
  note: demoFile.meta.note.includes('里編組調整')
    ? demoFile.meta.note
    : `${demoFile.meta.note}；新北 115-07-01 里編組調整的母里已標 stale（描述的是分割前範圍），待內政部更新`,
};
writeFileSync(DEMO_PATH, JSON.stringify(demoFile), 'utf8');

// ── 6. index.json 里數同步 ───────────────────────────────────
const index = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
const county = index.counties.find((c) => c.code === '65000');
if (county) county.villages = calcFile.villages.length;
const totalVillages = index.counties.reduce((s, c) => s + c.villages, 0);
index.meta.scope = `全臺 ${index.counties.length} 縣市，共 ${totalVillages.toLocaleString()} 個村里`;
writeFileSync(INDEX_PATH, JSON.stringify(index), 'utf8');

console.log(`新增里：${added.map((a) => `${a.district}${a.village}(人口 ${a.pop_total} → 選舉人推估 ${a.pop_eligible_est})`).join('、') || '無'}`);
console.log(`移除里：${removed.join('、') || '無'}`);
for (const t of touched) console.log(`↻ ${t.key} 人口 ${t.pop}，選舉人數 ${t.before} → ${t.after}`);
console.log(`demo 標記過期（分割前範圍）：${staled.join('、') || '無（先前已標記）'}`);
console.log(`新北市里數：${calcFile.villages.length}（官方 ${official.size}）／全臺 ${totalVillages}`);
