#!/usr/bin/env node
/**
 * 短影音產線：config.json + 素材 → 1080x1920 MP4
 *   node render.mjs projects/01-calculator/config.json
 *   node render.mjs <config> --preview 8      只算前 8 秒（改字幕時快速看）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  chromiumPath, ff, ffPipe, write, concat, audioGraph,
  normalizeVideo, normalizeImage, renderHtmlSegment,
} from './lib/pipeline.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const configPath = path.resolve(argv[0] ?? path.join(HERE, 'projects/01-calculator/config.json'));
const previewArg = argv.indexOf('--preview');
const previewSec = previewArg >= 0 ? Number(argv[previewArg + 1]) : null;

const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const baseDir = path.dirname(configPath);
const rel = p => (p ? path.resolve(baseDir, p) : null);

const W = cfg.width ?? 1080, H = cfg.height ?? 1920, fps = cfg.fps ?? 30;
const name = cfg.slug ?? path.basename(baseDir);

const outDir = path.join(HERE, 'out');
const work = path.join(HERE, '.cache', 'work', name);
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

/* ---------- 時間軸 ---------- */
let clock = 0;
const shots = cfg.shots.map((s, i) => {
  const at = clock; clock += s.dur;
  return { ...s, i, at };
});
const totalRaw = clock;
const total = previewSec ? Math.min(previewSec, totalRaw) : totalRaw;

console.log(`\n▶ ${cfg.title ?? name}`);
console.log(`  ${W}×${H} @${fps}fps ・ ${shots.length} 顆鏡頭 ・ ${totalRaw.toFixed(1)} 秒`
  + (previewSec ? `（預覽前 ${total} 秒）` : ''));
if (cfg.duration && Math.abs(cfg.duration - totalRaw) > 0.05) {
  console.log(`  ⚠ 鏡頭總長 ${totalRaw.toFixed(1)}s 與 config.duration ${cfg.duration}s 不一致`);
}

/* ---------- 缺素材時的檢查 ---------- */
const missing = shots.filter(s => s.src && !fs.existsSync(rel(s.src)));
if (missing.length) {
  console.error('\n✗ 找不到素材：');
  missing.forEach(s => console.error(`  鏡頭 ${s.i + 1}: ${s.src}`));
  console.error(`\n  把檔案放進 ${path.join(baseDir, 'media')}/ 再跑一次。`);
  process.exit(1);
}

/* ---------- 字幕遮罩：把重疊的字幕時段併起來，避免疊兩層變太暗 ---------- */
function scrimWindows(caps) {
  const iv = caps.map(c => [c.t - 0.25, c.t + c.d + 0.25]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of iv) {
    const last = out[out.length - 1];
    if (last && s <= last[1] + 0.2) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** 從區間集合 windows 扣掉 holes，回傳剩下的區間 */
function subtract(windows, holes) {
  let out = windows;
  for (const [hs, he] of holes) {
    const next = [];
    for (const [s, e] of out) {
      if (he <= s || hs >= e) { next.push([s, e]); continue; }
      if (s < hs) next.push([s, hs]);
      if (he < e) next.push([he, e]);
    }
    out = next;
  }
  return out.filter(([s, e]) => e - s > 0.15);
}

/* ---------- 疊加層時間軸 ---------- */
const captions = (cfg.captions ?? []).map(c => ({ type: 'caption', ...c }));

// 深色圖文卡本身就夠對比，不鋪遮罩；實拍鏡頭和淺色卡一律鋪，否則字會被背景吃掉
const darkCard = s => s.type === 'card' && (s.variant ?? 'ink') !== 'paper';
const noScrim = shots.filter(darkCard).map(s => [s.at, s.at + s.dur]);

const overlayElements = [
  ...(cfg.autoScrim === false ? [] :
    subtract(scrimWindows(captions), noScrim).map(([s, e]) => ({
      type: 'scrim', t: Math.max(0, s), d: e - Math.max(0, s), in: 0.3, out: 0.3,
    }))),
  ...(cfg.overlays ?? []),
  ...captions,
];

/* ---------- 瀏覽器 ---------- */
const { chromium } = await import('playwright');
const browser = await chromium.launch({
  executablePath: chromiumPath(),
  args: ['--force-color-profile=srgb', '--font-render-hinting=none'],
});

async function scenePage(spec) {
  const tpl = fs.readFileSync(path.join(HERE, 'templates', 'scene.html'), 'utf8');
  const file = path.join(HERE, '.cache', `scene-${spec.mode}-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(file, tpl.replace('__SPEC__', JSON.stringify(spec)));
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(file).href);
  await page.evaluate(() => window.ready);
  return { page, file };
}

/* ---------- 1. 每顆鏡頭 → 統一規格的片段 ---------- */
console.log('\n[1/3] 處理鏡頭');
const segs = [];
for (const s of shots) {
  if (previewSec && s.at >= total) break;
  const dur = previewSec ? Math.min(s.dur, total - s.at) : s.dur;
  const out = path.join(work, `seg${String(s.i).padStart(2, '0')}.mp4`);
  const kind = s.type === 'card' ? '圖文卡'
    : /\.(jpe?g|png|webp|heic)$/i.test(s.src) ? '照片' : '影片';
  process.stdout.write(`  ${s.i + 1}/${shots.length} ${kind} ${dur.toFixed(1)}s … `);

  if (s.type === 'card') {
    const { page, file } = await scenePage({
      mode: 'bg', W, H, fps,
      elements: [{ type: 'card', variant: s.variant ?? 'ink', t: 0, d: dur, in: 0.01, out: 0.01 }],
    });
    await renderHtmlSegment(page, out, { W, H, fps, dur });
    await page.close(); fs.rmSync(file, { force: true });
  } else if (kind === '照片') {
    await normalizeImage(rel(s.src), out, { W, H, fps, dur, motion: s.motion ?? 'in' });
  } else {
    await normalizeVideo(rel(s.src), out, { W, H, fps, dur, start: s.in ?? 0, speed: s.speed ?? 1 });
  }
  segs.push(out);
  console.log('ok');
}

const base = path.join(work, 'base.mp4');
await concat(segs, base, work);

/* ---------- 2. 疊加層逐格畫進最終編碼 ---------- */
console.log('\n[2/3] 疊字幕 / 動態圖文');
const { page: ovPage, file: ovFile } = await scenePage({
  mode: 'overlay', W, H, fps, elements: overlayElements,
});

const vo = rel(cfg.audio?.voiceover), music = rel(cfg.audio?.music);
for (const [k, p] of [['旁白', vo], ['配樂', music]]) {
  if (p && !fs.existsSync(p)) {
    console.log(`  ⚠ 找不到${k}：${path.relative(baseDir, p)}（這次先不混音）`);
  }
}
const A = audioGraph({
  voiceover: vo && fs.existsSync(vo) ? vo : null,
  music: music && fs.existsSync(music) ? music : null,
  musicGain: cfg.audio?.musicGain ?? 0.16,
  voGain: cfg.audio?.voGain ?? 1,
  speechNorm: cfg.audio?.speechNorm ?? true,
  total,
});

const finalOut = path.join(outDir, `${name}${previewSec ? '-preview' : ''}.mp4`);
const filter = `[0:v][1:v]overlay=0:0:format=auto[vout]` + (A.filter ? `;${A.filter}` : '');
const args = [
  '-y', '-i', base,
  '-framerate', String(fps), '-f', 'image2pipe', '-c:v', 'png', '-i', 'pipe:0',
  ...A.inputs,
  '-filter_complex', filter,
  '-map', '[vout]',
  ...(A.map ? ['-map', A.map, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000'] : ['-an']),
  '-t', String(total),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', String(cfg.crf ?? 19),
  '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(fps),
  '-movflags', '+faststart', finalOut,
];
const { proc, done } = ffPipe(args, '最終輸出');

const frames = Math.round(total * fps);
for (let i = 0; i < frames; i++) {
  await ovPage.evaluate(t => window.seek(t), i / fps);
  await write(proc.stdin, await ovPage.screenshot({ type: 'png', omitBackground: true }));
  if (i % 60 === 0) process.stdout.write(`\r  ${Math.round(i / frames * 100)}%  `);
}
proc.stdin.end();
await done;
console.log('\r  100%   ');

/* ---------- 3. 封面 ---------- */
console.log('\n[3/3] 輸出封面');
const poster = path.join(outDir, `${name}-cover.jpg`);
await ff(['-y', '-ss', String(cfg.coverAt ?? 1.2), '-i', finalOut,
  '-frames:v', '1', '-q:v', '2', poster], { label: '封面' });

await ovPage.close(); fs.rmSync(ovFile, { force: true });
await browser.close();

const mb = (fs.statSync(finalOut).size / 1048576).toFixed(1);
console.log(`\n✓ 影片  ${path.relative(process.cwd(), finalOut)}  (${mb} MB, ${total.toFixed(1)}s)`);
console.log(`✓ 封面  ${path.relative(process.cwd(), poster)}\n`);
