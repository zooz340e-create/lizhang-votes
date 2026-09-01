// 同票抽籤案修補 — 中選會靜態檔在平手選區把兩人都標 is_victor="?"，
// 抽籤結果從未回填，導致計算機顯示錯誤（隨機）當選人（2026-09 用戶回報
// 桃園八德廣隆里而發現，全庫掃出 18 案：2022 八案、2018 十案）。
//
// 當選人查證來源（2026-09-02）：
//  2022（抽籤日 2022-11-28 新聞）：福基村=葉步謀(中央社)、六合村=張綺苓、
//   內寮村=吳昭安(自由)、內林里=簡和仁、東興村=張政僑(中央社)、
//   德成村=蔡傳恭、灣愛里=邱清勳、廣隆里=蘇臻宥(自由/中時)
//  2018：七案由 2022 中選會 is_current="Y"（現任=上屆抽籤贏家）反推：
//   龍騰村=吳陳貞蓉、湖山里=鄧玉足、竹圍里=姜俊豪、德榮村=林明成、
//   中原里=蔡崇銘、光興里=陳德旺、武鹿里=陳意和；
//   瓦硐村=吳清在(自由 2018-11-26)、新光里=何智昌(中央社 2018-11-26)
//  烏來信賢里(2018)：查無公開報導 → 不標當選人，只標 tie（前端顯示同票）
//
// 用法：node etl/fix_tie_lotteries.mjs（可重複執行，冪等）

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = join(__dirname, '..', 'public', 'data', 'county');

const FIXES = [
  { file: '10005', district: '公館鄉', village: '福基村', year: 2022, winner: '葉步謀' },
  { file: '10009', district: '莿桐鄉', village: '六合村', year: 2022, winner: '張綺苓' },
  { file: '10009', district: '元長鄉', village: '內寮村', year: 2022, winner: '吳昭安' },
  { file: '10010', district: '大林鎮', village: '內林里', year: 2022, winner: '簡和仁' },
  { file: '10010', district: '民雄鄉', village: '東興村', year: 2022, winner: '張政僑' },
  { file: '10013', district: '長治鄉', village: '德成村', year: 2022, winner: '蔡傳恭' },
  { file: '64000', district: '三民區', village: '灣愛里', year: 2022, winner: '邱清勳' },
  { file: '68000', district: '八德區', village: '廣隆里', year: 2022, winner: '蘇臻宥' },
  { file: '10005', district: '三義鄉', village: '龍騰村', year: 2018, winner: '吳陳貞蓉' },
  { file: '10009', district: '斗六市', village: '湖山里', year: 2018, winner: '鄧玉足' },
  { file: '10010', district: '朴子市', village: '竹圍里', year: 2018, winner: '姜俊豪' },
  { file: '10013', district: '長治鄉', village: '德榮村', year: 2018, winner: '林明成' },
  { file: '10016', district: '白沙鄉', village: '瓦硐村', year: 2018, winner: '吳清在' },
  { file: '10018', district: '東區', village: '新光里', year: 2018, winner: '何智昌' },
  { file: '64000', district: '鹽埕區', village: '中原里', year: 2018, winner: '蔡崇銘' },
  { file: '64000', district: '內門區', village: '光興里', year: 2018, winner: '陳德旺' },
  { file: '66000', district: '清水區', village: '武鹿里', year: 2018, winner: '陳意和' },
  { file: '65000', district: '烏來區', village: '信賢里', year: 2018, winner: null }, // 查證中
];

const byFile = new Map();
for (const f of FIXES) {
  if (!byFile.has(f.file)) byFile.set(f.file, []);
  byFile.get(f.file).push(f);
}

for (const [file, fixes] of byFile) {
  const path = join(dir, `${file}.json`);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  for (const fix of fixes) {
    const v = data.villages.find((x) => x.district === fix.district && x.village === fix.village);
    if (!v) { console.warn(`⚠️ 找不到 ${fix.district}${fix.village}（可能已因行政區調整移除）`); continue; }
    const e = (v.history ?? []).find((x) => x.year === fix.year);
    if (!e) { console.warn(`⚠️ ${fix.village} 無 ${fix.year} 資料`); continue; }
    e.tie = true; // 同票抽籤案標記
    if (fix.winner) {
      let hit = false;
      for (const c of e.candidates) {
        c.won = c.name === fix.winner;
        if (c.won) hit = true;
      }
      if (!hit) console.warn(`⚠️ ${fix.village} ${fix.year} 找不到候選人 ${fix.winner}`);
      else console.log(`✅ ${fix.district}${fix.village} ${fix.year}：${fix.winner}（抽籤當選）`);
    } else {
      console.log(`ℹ️ ${fix.district}${fix.village} ${fix.year}：僅標同票（當選人查證中）`);
    }
  }
  writeFileSync(path, JSON.stringify(data), 'utf8');
}
console.log('完成。');
