// Podcast《先問，為什麼？》RSS 產生器 — 自架、免平台、Apple Podcasts / Spotify 都吃
//
// 讀 podcast/show.json → 寫 public/podcast/feed.xml（RSS 2.0 + iTunes 命名空間）
//                      → 寫 public/podcast/index.html（節目頁：訂閱鈕＋集數列表）
//
// 用法：node etl/podcast_feed.mjs
//   - 音檔放 public/podcast/<file>（mp3），沒放的集數會被跳過並警告
//   - 時長用 ffprobe 抓（沒裝就省略 itunes:duration，Apple 不強制）
//   - 封面 public/podcast/cover.jpg：3000×3000、RGB、JPG（Apple 規定 1400–3000 正方形）
//
// 上架流程（一次性，需本人登入）：
//   Apple：podcastsconnect.apple.com → 新增節目 → 貼 feed.xml 網址 → 驗證信寄到 ownerEmail
//   Spotify：creators.spotify.com → 新增節目 → 「已有 RSS」→ 貼 feed.xml 網址
//   之後每集只要：放 mp3 → 改 show.json → 跑本檔 → push，兩邊 24 小時內自動更新

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const show = JSON.parse(readFileSync(join(root, 'podcast', 'show.json'), 'utf8'));
const outDir = join(root, 'public', 'podcast');
mkdirSync(outDir, { recursive: true });

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cdata = (s) => `<![CDATA[${String(s).replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`;
const rfc822 = (iso) => new Date(iso).toUTCString();
const hms = (sec) => {
  const s = Math.round(sec);
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
function probeDuration(path) {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], { encoding: 'utf8' });
    const d = Number(out.trim());
    return Number.isFinite(d) ? d : undefined;
  } catch {
    return undefined;
  }
}

// ── 集數：只收音檔存在的 ─────────────────────────────────
const items = [];
const skipped = [];
for (const ep of show.episodes) {
  const audioPath = join(outDir, ep.file);
  if (!existsSync(audioPath)) {
    skipped.push(`${ep.title}（缺 public/podcast/${ep.file}）`);
    continue;
  }
  const bytes = statSync(audioPath).size;
  const dur = probeDuration(audioPath);
  items.push({ ...ep, bytes, dur, url: `${show.baseUrl}/${ep.file}` });
}
items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

// ── feed.xml ─────────────────────────────────────────────
const cats = show.categories
  .map((c) =>
    c.sub
      ? `    <itunes:category text="${esc(c.name)}">\n      <itunes:category text="${esc(c.sub)}"/>\n    </itunes:category>`
      : `    <itunes:category text="${esc(c.name)}"/>`,
  )
  .join('\n');
const fullTitle = `${show.title} ${show.subtitle}`.trim();
const lastBuild = items[0]?.pubDate ?? new Date().toISOString();

const itemXml = items
  .map(
    (ep) => `    <item>
      <title>${esc(ep.title)}</title>
      <itunes:title>${esc(ep.title)}</itunes:title>
      <guid isPermaLink="false">${esc(`${show.baseUrl}/${ep.file}`)}</guid>
      <link>${esc(show.siteUrl)}#ep${ep.number}</link>
      <pubDate>${rfc822(ep.pubDate)}</pubDate>
      <description>${cdata(ep.notes)}</description>
      <content:encoded>${cdata(ep.notes)}</content:encoded>
      <itunes:summary>${esc(ep.summary)}</itunes:summary>
      <enclosure url="${esc(ep.url)}" length="${ep.bytes}" type="audio/mpeg"/>
      <itunes:episode>${ep.number}</itunes:episode>
      <itunes:episodeType>${ep.type ?? 'full'}</itunes:episodeType>${ep.dur ? `\n      <itunes:duration>${hms(ep.dur)}</itunes:duration>` : ''}
      <itunes:explicit>${show.explicit ? 'true' : 'false'}</itunes:explicit>
      <itunes:image href="${esc(`${show.baseUrl}/${show.image}`)}"/>
    </item>`,
  )
  .join('\n');

const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <title>${esc(fullTitle)}</title>
    <link>${esc(show.siteUrl)}</link>
    <atom:link href="${esc(`${show.baseUrl}/feed.xml`)}" rel="self" type="application/rss+xml"/>
    <language>${esc(show.language)}</language>
    <copyright>${esc(show.copyright)}</copyright>
    <lastBuildDate>${rfc822(lastBuild)}</lastBuildDate>
    <description>${cdata(show.description)}</description>
    <itunes:summary>${esc(show.description)}</itunes:summary>
    <itunes:subtitle>${esc(show.subtitle)}</itunes:subtitle>
    <itunes:author>${esc(show.author)}</itunes:author>
    <itunes:owner>
      <itunes:name>${esc(show.ownerName)}</itunes:name>
      <itunes:email>${esc(show.ownerEmail)}</itunes:email>
    </itunes:owner>
    <itunes:image href="${esc(`${show.baseUrl}/${show.image}`)}"/>
    <image>
      <url>${esc(`${show.baseUrl}/${show.image}`)}</url>
      <title>${esc(fullTitle)}</title>
      <link>${esc(show.siteUrl)}</link>
    </image>
${cats}
    <itunes:explicit>${show.explicit ? 'true' : 'false'}</itunes:explicit>
    <itunes:type>${esc(show.type)}</itunes:type>
    <itunes:keywords>${esc(show.keywords)}</itunes:keywords>
    <podcast:locked>no</podcast:locked>
${itemXml}
  </channel>
</rss>
`;
writeFileSync(join(outDir, 'feed.xml'), feed, 'utf8');

// ── index.html 節目頁 ─────────────────────────────────────
const epHtml = (show.episodes.length ? show.episodes : [])
  .slice()
  .sort((a, b) => b.number - a.number)
  .map((ep) => {
    const live = items.find((i) => i.number === ep.number);
    return `      <article class="ep" id="ep${ep.number}">
        <div class="ep-meta">EP${ep.number}${ep.type === 'trailer' ? ' · 預告' : ''} · ${new Date(ep.pubDate).toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' })}${live?.dur ? ` · ${Math.round(live.dur / 60)} 分鐘` : ''}</div>
        <h2>${esc(ep.title)}</h2>
        <p>${esc(ep.summary)}</p>
        ${live ? `<audio controls preload="none" src="${esc(live.url)}"></audio>` : `<p class="soon">錄製中，上線後這裡會出現播放器。</p>`}
        <details><summary>節目筆記</summary>${ep.notes}</details>
      </article>`;
  })
  .join('\n');

const page = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(show.title)} — ${esc(show.subtitle)}</title>
<meta name="description" content="${esc(show.description.split('\n')[0])}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(show.description.split('\n')[0])}">
<meta property="og:image" content="${esc(`${show.baseUrl}/${show.image}`)}">
<link rel="alternate" type="application/rss+xml" title="${esc(fullTitle)}" href="${esc(`${show.baseUrl}/feed.xml`)}">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>❓</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&family=Noto+Serif+TC:wght@700;900&display=swap">
<style>
  :root{--ink:#111110;--paper:#f4f1ea;--mute:#6f6c66;--line:#d9d4c7;--red:#c0392b}
  *{box-sizing:border-box}
  body{margin:0;background:var(--ink);color:var(--paper);font-family:"Noto Sans TC",system-ui,sans-serif;line-height:1.7}
  .wrap{max-width:720px;margin:0 auto;padding:40px 20px 80px}
  header{display:grid;grid-template-columns:140px 1fr;gap:24px;align-items:end}
  header img{width:140px;height:140px;display:block;border:2px solid var(--paper)}
  .kicker{font-size:12px;letter-spacing:.35em;color:var(--mute);text-transform:uppercase}
  h1{font-family:"Noto Serif TC",serif;font-weight:900;font-size:44px;line-height:1.1;margin:6px 0 4px}
  h1 small{display:block;font-family:"Noto Sans TC";font-weight:700;font-size:14px;letter-spacing:.3em;color:var(--mute);margin-top:6px}
  .host{color:var(--mute);font-size:14px}
  .desc{margin:28px 0;white-space:pre-line;font-size:15px}
  .subs{display:flex;flex-wrap:wrap;gap:10px;margin:20px 0 40px}
  .subs a{border:2px solid var(--paper);color:var(--paper);text-decoration:none;padding:10px 16px;font-weight:700;font-size:14px}
  .subs a:hover{background:var(--paper);color:var(--ink)}
  .subs a.pending{border-color:var(--mute);color:var(--mute);pointer-events:none}
  .ep{border-top:2px solid var(--paper);padding:28px 0}
  .ep-meta{font-size:12px;letter-spacing:.2em;color:var(--mute)}
  .ep h2{font-family:"Noto Serif TC",serif;font-weight:900;font-size:24px;line-height:1.3;margin:8px 0 10px}
  .ep p{margin:0 0 14px;font-size:15px}
  .soon{color:var(--mute)}
  audio{width:100%;margin:6px 0 14px;filter:invert(1) hue-rotate(180deg)}
  details{font-size:14px;color:#cfcac0}
  summary{cursor:pointer;font-weight:700;color:var(--paper)}
  details ul{padding-left:20px}
  details a{color:var(--paper)}
  footer{margin-top:60px;font-size:12px;color:var(--mute);border-top:1px solid #333;padding-top:16px;line-height:1.8}
  footer a{color:var(--mute)}
  @media (max-width:520px){header{grid-template-columns:1fr}h1{font-size:36px}}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <img src="${esc(show.image)}" alt="${esc(fullTitle)} 封面">
    <div>
      <div class="kicker">Podcast</div>
      <h1>${esc(show.title)}<small>${esc(show.subtitle).toUpperCase()}</small></h1>
      <div class="host">主持：${esc(show.author)}</div>
    </div>
  </header>
  <div class="desc">${esc(show.description)}</div>
  <div class="subs">
    <a class="pending" href="#" title="送審中">Apple Podcasts（送審中）</a>
    <a class="pending" href="#" title="送審中">Spotify（送審中）</a>
    <a href="feed.xml">RSS</a>
  </div>
${epHtml}
  <footer>
    ${esc(show.copyright)}　｜　<a href="../">里長票數計算機</a>　｜　<a href="feed.xml">RSS feed</a><br>
    本計畫的販售與服務所得為計畫營收，不收受、不代收政治獻金。
  </footer>
</div>
</body>
</html>
`;
writeFileSync(join(outDir, 'index.html'), page, 'utf8');

console.log(`feed.xml：${items.length} 集（${items.map((i) => `EP${i.number} ${(i.bytes / 1048576).toFixed(1)}MB${i.dur ? ' ' + hms(i.dur) : ''}`).join('、') || '無'}）`);
if (skipped.length) console.log(`跳過（缺音檔）：\n  ${skipped.join('\n  ')}`);
if (!existsSync(join(outDir, show.image))) console.log(`⚠ 缺封面 public/podcast/${show.image}`);
if (items.length === 0) console.log('⚠ Apple Podcasts 送審需要至少一集有音檔。');
