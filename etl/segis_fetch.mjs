// SEGIS（內政部社會經濟資料服務平台）開放服務抓取 — 教練後台 S 區資料管線
//
// 原理：每個 SEGIS 資料集頁的「JSON」鈕背後是免驗證的開放服務端點：
//   https://segisws.moi.gov.tw/STATWSSTData/OpenService.asmx/GetAdminSTDataForOpenCode?oCode=<碼>
// 無 Cloudflare、免登入。oCode 從資料集頁（QueryInterfaceView）的 JSON 按鈕 data-url 取得。
//
// 用法：node etl/segis_fetch.mjs            # 抓 DATASETS 全部並輸出東區 22 里報表
// 範圍：目前僅過濾彰化市東區 22 里（etl/data/changhua_east_villages.json）；擴大＝換名單檔。

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');
const EAST = JSON.parse(readFileSync(join(__dirname, 'data', 'changhua_east_villages.json'), 'utf8'));

const BASE = 'https://segisws.moi.gov.tw/STATWSSTData/OpenService.asmx/GetAdminSTDataForOpenCode?oCode=';

// oCode 註冊表：新資料集只要把資料集頁 JSON 鈕的 oCode 貼進來
const DATASETS = [
  {
    key: 'pop_114Y12M',
    name: '行政區人口統計_村里（114年12月）',
    oCode: 'ECC48479C0B91632E91C5874DF23C60E51A1FBEE829C41DBF0767011744D917A2539094FCB65D41BDDE79C332EB9258D',
    fields: ['H_CNT', 'P_CNT', 'M_CNT', 'F_CNT'],
    labels: { H_CNT: '戶數', P_CNT: '人口', M_CNT: '男', F_CNT: '女' },
  },
  // { key: 'edu', name: '15歲以上教育程度_村里', oCode: '待補', ... },
  // { key: 'labor', name: '勞動就業_村里', oCode: '待補', ... },
  // { key: 'income', name: '金融經濟_村里', oCode: '待補', ... },
];

async function fetchDataset(ds) {
  const res = await fetch(BASE + ds.oCode, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
  });
  if (!res.ok) throw new Error(`${ds.key} HTTP ${res.status}`);
  const raw = await res.text();
  // .asmx 可能把 JSON 包在 XML 元素裡
  const m = raw.match(/>(\[[\s\S]*\]|\{[\s\S]*\})</);
  const data = JSON.parse(m ? m[1] : raw);
  return Array.isArray(data) ? data : (data.RowDataList ?? Object.values(data).find(Array.isArray) ?? []);
}

function pad(s, w) {
  const len = [...String(s)].reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 2 : 1), 0);
  return String(s) + ' '.repeat(Math.max(0, w - len));
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const names = new Set(EAST.villages.map((v) => v.village));
  // SEGIS 罕用字會壞掉成「?」（例：寶廍里→寶?里），用萬用字元回配
  const matchName = (segisName) => {
    if (names.has(segisName)) return segisName;
    if (!/[?？]/.test(segisName)) return null;
    const re = new RegExp('^' + segisName.replace(/[.*+^${}()|[\]\\]/g, '\\$&').replace(/[?？]/g, '.') + '$');
    for (const n of names) if (re.test(n)) return n;
    return null;
  };
  const merged = {};
  for (const v of EAST.villages) merged[v.village] = { ...v };

  for (const ds of DATASETS) {
    process.stdout.write(`抓 ${ds.name} … `);
    const rows = await fetchDataset(ds);
    let hits = 0;
    for (const r of rows) {
      if (r.TOWN !== '彰化市') continue;
      const name = matchName(r.VILLAGE);
      if (!name) continue;
      hits++;
      merged[name][ds.key] = Object.fromEntries(ds.fields.map((f) => [f, r[f]]));
      merged[name].V_ID = r.V_ID;
    }
    console.log(`全國 ${rows.length} 筆，東區命中 ${hits}/${names.size}`);
  }

  const out = { generated_at: new Date().toISOString().slice(0, 10), scope: '彰化市東區 22 里', villages: merged };
  writeFileSync(join(OUT_DIR, 'changhua_east_s_data.json'), JSON.stringify(out, null, 1), 'utf8');

  // 終端報表：戶數＝陸戰分母
  console.log('\n' + pad('里別', 10) + pad('鄰數', 6) + pad('戶數', 8) + pad('人口', 8) + pad('戶均', 6) + '現任里長');
  const list = Object.values(merged).sort((a, b) => (b.pop_114Y12M?.P_CNT ?? 0) - (a.pop_114Y12M?.P_CNT ?? 0));
  for (const v of list) {
    const p = v.pop_114Y12M ?? {};
    const avg = p.H_CNT ? (p.P_CNT / p.H_CNT).toFixed(2) : '-';
    console.log(pad(v.village, 10) + pad(v.neighborhoods, 6) + pad(p.H_CNT ?? '-', 8) + pad(p.P_CNT ?? '-', 8) + pad(avg, 6) + v.chief);
  }
  console.log(`\n輸出 → etl/out/changhua_east_s_data.json`);
}

main().catch((e) => { console.error('失敗：', e.message); process.exit(1); });
