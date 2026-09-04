import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);

/* ---------- 執行檔位置 ---------- */
export const FFMPEG = require('ffmpeg-static');

export function chromiumPath() {
  const { chromium } = require('playwright');
  const p = chromium.executablePath();
  if (fs.existsSync(p)) return p;
  // 這台機器預裝的 Chromium 版號和 playwright 預期的不同，自己找
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  for (const d of fs.readdirSync(root)) {
    for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
      const c = path.join(root, d, rel);
      if (d.startsWith('chromium-') && fs.existsSync(c)) return c;
    }
  }
  throw new Error('找不到 Chromium，請執行 npx playwright install chromium');
}

/* ---------- ffmpeg 小工具 ---------- */
export function ff(args, { label = 'ffmpeg' } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...args],
      { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve()
      : reject(new Error(`${label} 失敗 (code ${code})\n${err.slice(-3000)}`)));
  });
}

/** 開一個吃 PNG 串流的 ffmpeg，回傳 { proc, done } */
export function ffPipe(args, label = 'ffmpeg') {
  const proc = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...args],
    { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  proc.stderr.on('data', d => { err += d; });
  const done = new Promise((resolve, reject) => {
    proc.on('error', reject);
    proc.on('close', code => code === 0 ? resolve()
      : reject(new Error(`${label} 失敗 (code ${code})\n${err.slice(-3000)}`)));
  });
  return { proc, done };
}

/** 有背壓控制地把 buffer 寫進 stdin */
export function write(stream, buf) {
  return stream.write(buf) ? Promise.resolve()
    : new Promise(r => stream.once('drain', r));
}

/* ---------- 素材正規化：任何來源 → 1080x1920 固定長度片段 ---------- */
const cover = (W, H, fps) =>
  `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${fps},setsar=1`;

const ENC = fps => [
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16',
  '-pix_fmt', 'yuv420p', '-r', String(fps), '-g', String(fps * 2), '-an',
];

export async function normalizeVideo(src, out, { W, H, fps, start = 0, dur, speed = 1 }) {
  const vf = speed !== 1
    ? `setpts=${(1 / speed).toFixed(6)}*PTS,${cover(W, H, fps)}`
    : cover(W, H, fps);
  await ff(['-y', '-ss', String(start), '-i', src, '-t', String(dur),
    '-vf', vf, ...ENC(fps), out], { label: `轉檔 ${path.basename(src)}` });
}

export async function normalizeImage(src, out, { W, H, fps, dur, motion = 'in' }) {
  const frames = Math.round(dur * fps);
  // 先放大到 2 倍畫布再 zoompan，避免 zoompan 低解析度抖動
  const z = motion === 'none' ? '1'
    : motion === 'out' ? `max(1.16-0.0016*on,1.0)`
    : `min(1.0+0.0016*on,1.16)`;
  const pan = motion === 'none'
    ? `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`
    : `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},`
      + `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${fps}`;
  await ff(['-y', '-loop', '1', '-i', src, '-t', String(dur),
    '-vf', `${pan},fps=${fps},setsar=1`, ...ENC(fps), out],
    { label: `轉檔 ${path.basename(src)}` });
}

/** 用瀏覽器把 HTML 場景逐格畫成一段影片（card shot / 純圖文鏡頭用） */
export async function renderHtmlSegment(page, out, { W, H, fps, dur }) {
  const frames = Math.round(dur * fps);
  const { proc, done } = ffPipe([
    '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', 'pipe:0',
    '-vf', `fps=${fps},setsar=1`, ...ENC(fps), out,
  ], '圖文鏡頭');
  for (let i = 0; i < frames; i++) {
    await page.evaluate(t => window.seek(t), i / fps);
    await write(proc.stdin, await page.screenshot({ type: 'png' }));
  }
  proc.stdin.end();
  await done;
}

/* ---------- 串接 ---------- */
export async function concat(segments, out, workDir) {
  const list = path.join(workDir, 'concat.txt');
  fs.writeFileSync(list, segments.map(s => `file '${s.replace(/'/g, "'\\''")}'`).join('\n'));
  await ff(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out], { label: '串接' });
}

/* ---------- 音軌 ---------- */
/** 回傳 { inputs, filter, map } — 旁白為主、配樂自動閃避（sidechain ducking） */
export function audioGraph({ voiceover, music, musicGain = 0.16, voGain = 1, total, speechNorm = true }) {
  const inputs = [];
  const idx = {};
  if (voiceover) { idx.vo = 2 + inputs.length; inputs.push('-i', voiceover); }
  if (music) { idx.bgm = 2 + inputs.length; inputs.push('-i', music); }
  if (!voiceover && !music) return { inputs: [], filter: null, map: null };

  const fmt = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';
  const fadeOut = `afade=t=out:st=${Math.max(0, total - 1.2).toFixed(2)}:d=1.2`;
  const parts = [];

  if (voiceover && music) {
    parts.push(`[${idx.vo}:a]${fmt}${speechNorm ? ',speechnorm=e=12.5:r=0.0001:l=1' : ''},volume=${voGain},asplit=2[vo1][vo2]`);
    parts.push(`[${idx.bgm}:a]${fmt},volume=${musicGain},${fadeOut}[m]`);
    parts.push(`[m][vo2]sidechaincompress=threshold=0.035:ratio=8:attack=8:release=380[md]`);
    parts.push(`[vo1][md]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95[a]`);
  } else if (voiceover) {
    parts.push(`[${idx.vo}:a]${fmt}${speechNorm ? ',speechnorm=e=12.5:r=0.0001:l=1' : ''},volume=${voGain},alimiter=limit=0.95[a]`);
  } else {
    parts.push(`[${idx.bgm}:a]${fmt},volume=${musicGain},${fadeOut},alimiter=limit=0.95[a]`);
  }
  return { inputs, filter: parts.join(';'), map: '[a]' };
}
