#!/usr/bin/env node
/** 下載影片產線需要的字型，並確認 Chromium / ffmpeg 可用。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FFMPEG, chromiumPath, ff } from './lib/pipeline.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fontDir = path.join(HERE, '.cache', 'fonts');
fs.mkdirSync(fontDir, { recursive: true });

for (const w of [400, 700, 900]) {
  const out = path.join(fontDir, `NotoSansTC-${w}.ttf`);
  if (fs.existsSync(out)) { console.log(`✓ 字型 ${w} 已存在`); continue; }
  const css = await (await fetch(
    `https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@${w}`,
    { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
  const url = css.match(/https:\/\/fonts\.gstatic\.com[^)]*\.ttf/)?.[0];
  if (!url) throw new Error(`拿不到字型 ${w} 的下載網址`);
  fs.writeFileSync(out, Buffer.from(await (await fetch(url)).arrayBuffer()));
  console.log(`✓ 下載字型 ${w}`);
}

console.log(`✓ ffmpeg   ${FFMPEG}`);
await ff(['-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=0.1', '-c:v', 'libx264',
  '-f', 'null', '-'], { label: 'H.264 檢查' });
console.log('✓ H.264 編碼可用');
console.log(`✓ Chromium ${chromiumPath()}`);
console.log('\n環境就緒。');
