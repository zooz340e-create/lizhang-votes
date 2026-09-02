// 選情圖卡產生器 — Canvas 繪製 1080×1350（IG 4:5 直式），純前端、零依賴
// 版式依用戶提供之設計稿（2026-09-02）：米底×墨綠×橘，六格關鍵數、
// 上屆得票分布橫條、里民年齡結構堆疊條（含 20 歲投票權註記）。
// 名詞口徑（本計畫既定義）：空氣票＝選舉人−當選票；游離票＝投票數−當選票。

import type { Village } from './calc';
import { voteShares } from './calc';
import type { DemoEntry, VillageRow } from './data';

const W = 1080;
const H = 1350;

const C = {
  bg: '#f5f2ea',
  ink: '#1c1c1a',
  gray: '#7d7a72',
  grayLight: '#b9b5aa',
  green: '#1e5045',
  greenDark: '#17332c',
  greenBanner: '#e3ede7',
  orange: '#c07a28',
  barGray: '#a8aca4',
  barLight: '#d9d5c9',
  line: '#d8d4c8',
};

const FONT = '"Noto Sans TC", "PingFang TC", sans-serif';
const nf = (n: number) => n.toLocaleString('zh-TW');

interface CardStats {
  electorateEst: number; // 推估選舉人數（20 歲以上人口，或退回上屆官方數）
  threshold: number; // 退保證金門檻
  lastWin?: number; // 上屆當選票
  air?: number; // 空氣票
  swing?: number; // 游離票
  noShow?: number; // 沒去投票
  margin?: number; // 上屆勝負差
  runnerUp?: number;
  candCount?: number;
  terms?: number; // 現任連任屆數
  uncontested?: boolean;
  invalid?: number; // 廢票
}

function computeStats(v: Village, terms: number, a20?: number): CardStats {
  const last = v.history?.[0];
  const electorateEst = a20 && a20 > 0 ? a20 : v.pop_eligible_est;
  const threshold = Math.ceil(electorateEst * 0.1);
  if (!last || last.candidates.length === 0) return { electorateEst, threshold };
  const sorted = [...last.candidates].sort((a, b) => b.votes - a.votes);
  const winner = last.candidates.find((c) => c.won) ?? sorted[0];
  const electorate = last.electorate ?? v.pop_eligible_est;
  const cast = Math.round(electorate * (last.turnout ?? 0));
  const valid = last.valid_votes ?? last.candidates.reduce((s, c) => s + c.votes, 0);
  const invalid = Math.max(0, cast - valid);
  return {
    electorateEst,
    threshold,
    lastWin: winner.votes,
    air: Math.max(0, electorate - winner.votes),
    swing: Math.max(0, cast - winner.votes),
    noShow: Math.max(0, electorate - cast),
    margin: sorted.length > 1 ? sorted[0].votes - sorted[1].votes : undefined,
    runnerUp: sorted[1]?.votes,
    candCount: last.candidates.length,
    terms,
    uncontested: !!last.uncontested,
    invalid,
  };
}

function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  opts: { weight?: number; color?: string; align?: CanvasTextAlign } = {},
) {
  ctx.font = `${opts.weight ?? 400} ${size}px ${FONT}`;
  ctx.fillStyle = opts.color ?? C.ink;
  ctx.textAlign = opts.align ?? 'left';
  ctx.fillText(s, x, y);
}

export async function drawShareCard(
  v: VillageRow,
  terms: number,
  demoEntry: DemoEntry | undefined,
  year: number,
): Promise<HTMLCanvasElement> {
  await (document.fonts?.ready ?? Promise.resolve());
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const s = computeStats(v, terms, demoEntry?.a20);
  const M = 68; // 左右邊距

  // 底 + 頂部墨綠條
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = C.green;
  ctx.fillRect(0, 0, W, 22);

  // 標題
  text(ctx, v.village, M, 140, 88, { weight: 900 });
  text(ctx, `${v.county}${v.district}`, M, 196, 34, { color: C.gray, weight: 500 });
  text(ctx, '里長選情卡', M + ctx.measureText(`${v.county}${v.district}`).width + 36, 196, 34, { color: C.gray, weight: 500 });
  text(ctx, String(year), W - M, 196, 34, { color: C.gray, weight: 500, align: 'right' });

  // 勝負差橫幅
  ctx.fillStyle = C.greenBanner;
  ctx.fillRect(M - 20, 226, W - 2 * (M - 20), 124);
  if (s.lastWin !== undefined) {
    const sub = s.uncontested
      ? '上屆同額競選 · 沒有對手自動當選'
      : `上屆 ${s.candCount} 位候選人登記${s.terms ? ` · 現任連任 ${s.terms} 屆` : ''}`;
    text(ctx, sub, M, 274, 30, { color: C.green, weight: 700 });
    if (!s.uncontested && s.margin !== undefined) {
      text(ctx, `上屆勝負差 ${nf(s.margin)} 票`, M, 330, 52, { weight: 900, color: C.greenDark });
      text(ctx, `${nf(s.lastWin)}  對  ${nf(s.runnerUp ?? 0)}`, W - M, 326, 38, { color: C.gray, align: 'right', weight: 500 });
    } else {
      text(ctx, `上屆同額 ${nf(s.lastWin)} 票自動當選`, M, 330, 52, { weight: 900, color: C.greenDark });
    }
  } else {
    text(ctx, '行政區調整新設 · 全新戰場', M, 274, 30, { color: C.green, weight: 700 });
    text(ctx, '沒有現任 · 沒有歷史包袱', M, 330, 52, { weight: 900, color: C.greenDark });
  }

  // 六格關鍵數（2×3）
  const tiles: Array<{ label: string; val: string; color?: string }> = [
    { label: '推估選舉人數', val: nf(s.electorateEst) },
    { label: '退保證金門檻', val: nf(s.threshold), color: C.orange },
    { label: '上屆當選票', val: s.lastWin !== undefined ? nf(s.lastWin) : '—' },
    { label: '空氣票', val: s.air !== undefined ? nf(s.air) : '—' },
    { label: '游離票', val: s.swing !== undefined ? nf(s.swing) : '—' },
    { label: '沒去投票', val: s.noShow !== undefined ? nf(s.noShow) : '—' },
  ];
  const gridTop = 400;
  const rowH = 116;
  const colW = (W - 2 * M) / 3;
  tiles.forEach((t, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const cx = M + colW * col + colW / 2;
    const cy = gridTop + row * rowH;
    text(ctx, t.label, cx, cy, 30, { color: C.gray, align: 'center', weight: 500 });
    text(ctx, t.val, cx, cy + 58, 60, { weight: 900, align: 'center', color: t.color ?? C.ink });
    if (col > 0) {
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(M + colW * col, cy - 22);
      ctx.lineTo(M + colW * col, cy + 66);
      ctx.stroke();
    }
  });
  text(ctx, '空氣票＝選舉人 減 當選票    ｜    游離票＝投票數 減 當選票（投給別人＋廢票）', W / 2, gridTop + 2 * rowH + 4, 27, {
    color: C.gray,
    align: 'center',
  });

  // 分隔線
  const div1 = gridTop + 2 * rowH + 40;
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(M, div1);
  ctx.lineTo(W - M, div1);
  ctx.stroke();

  // 上屆得票分布
  let cursorY = div1 + 50;
  const last = v.history?.[0];
  if (last && last.candidates.length > 0 && s.lastWin !== undefined) {
    text(ctx, '上屆得票分布', M, cursorY, 32, { weight: 700, color: C.gray });
    cursorY += 36;
    const shares = voteShares(last);
    const rows: Array<{ label: string; votes: number; color: string }> = shares.slice(0, 3).map((sh, i) => ({
      label: sh.won ? '當選' : `第 ${i + 1} 名`,
      votes: sh.votes,
      color: sh.won ? C.green : C.barGray,
    }));
    if (s.invalid && s.invalid > 0) rows.push({ label: '廢票', votes: s.invalid, color: C.barLight });
    const maxV = Math.max(...rows.map((r) => r.votes), 1);
    const barX = M + 180;
    const barMaxW = W - M - barX - 130;
    for (const r of rows) {
      text(ctx, r.label, M, cursorY + 25, 30, { color: C.gray, weight: 500 });
      ctx.fillStyle = r.color;
      ctx.fillRect(barX, cursorY, Math.max(18, (r.votes / maxV) * barMaxW), 32);
      text(ctx, nf(r.votes), W - M, cursorY + 27, 32, { align: 'right', weight: 700 });
      cursorY += 48;
    }
  } else {
    text(ctx, '尚無歷屆選舉資料 — 這裡的第一頁歷史，等你來寫。', M, cursorY + 20, 34, { color: C.gray, weight: 500 });
    cursorY += 120;
  }

  // 分隔線 2
  cursorY += 18;
  ctx.beginPath();
  ctx.moveTo(M, cursorY);
  ctx.lineTo(W - M, cursorY);
  ctx.stroke();
  cursorY += 48;

  // 里民結構（年齡堆疊條）
  if (demoEntry?.a20 !== undefined) {
    const tot = demoEntry.young + demoEntry.work + demoEntry.old;
    const u20 = tot - demoEntry.a20;
    const o60 = demoEntry.o60 ?? 0;
    const mid = demoEntry.a20 - o60;
    text(ctx, `里民結構`, M, cursorY, 32, { weight: 700, color: C.gray });
    text(ctx, `${demoEntry.y + 1911}    戶籍人口 ${nf(tot)} 人`, M + 160, cursorY, 32, { color: C.gray, weight: 500 });
    cursorY += 26;
    const segs = [
      { label: '未滿 20 歲', cnt: u20, color: C.barGray },
      { label: '20–59 歲', cnt: mid, color: C.green },
      { label: '60 歲以上', cnt: o60, color: C.orange },
    ];
    const barW = W - 2 * M;
    let x = M;
    for (const seg of segs) {
      const w = (seg.cnt / tot) * barW;
      ctx.fillStyle = seg.color;
      ctx.fillRect(x, cursorY, w, 48);
      const pct = Math.round((seg.cnt / tot) * 100);
      if (w > 90) text(ctx, `${pct}%`, x + w / 2, cursorY + 34, 30, { color: '#fff', align: 'center', weight: 700 });
      x += w;
    }
    cursorY += 76;
    // 圖例
    let lx = M;
    for (const seg of segs) {
      ctx.fillStyle = seg.color;
      ctx.fillRect(lx, cursorY - 24, 26, 26);
      text(ctx, seg.label, lx + 38, cursorY, 30, { color: C.gray, weight: 500 });
      text(ctx, `${nf(seg.cnt)} 人`, lx + 38, cursorY + 40, 34, { weight: 700 });
      lx += (W - 2 * M) / 3;
    }
    cursorY += 72;
    text(ctx, '20 歲以上才有投票權  —  未滿 20 歲那段不在你的選票池裡', M, cursorY, 30, { color: C.gray, weight: 500 });
  }

  // 頁尾
  const footY = H - 96;
  ctx.beginPath();
  ctx.moveTo(M, footY - 36);
  ctx.lineTo(W - M, footY - 36);
  ctx.stroke();
  text(ctx, '選舉數據：中央選舉委員會 111 年村(里)長選舉各投開票所候選人得票數一覽表', M, footY, 26, { color: C.gray });
  text(ctx, `人口數據：內政部 SEGIS（民國 ${demoEntry?.y ?? 114} 年 12 月）    保證金 3 萬元（115 年）`, M, footY + 34, 26, { color: C.gray });
  text(ctx, 'lizhang-votes.vercel.app   —   COV 里長練習生計畫', M, footY + 68, 26, { color: C.gray, weight: 700 });

  return canvas;
}

// 下載或分享（行動裝置優先走系統分享面板 → IG/FB/LINE）
export async function shareCard(v: VillageRow, terms: number, demoEntry: DemoEntry | undefined, year: number): Promise<'shared' | 'downloaded'> {
  const canvas = await drawShareCard(v, terms, demoEntry, year);
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
  const file = new File([blob], `${v.village}-選情卡.png`, { type: 'image/png' });
  // 只在行動裝置走系統分享面板（桌面 Chrome 的 canShare 也回 true，但體驗是彈窗不是存檔）
  const isMobile = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  if (isMobile && typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `${v.village} 里長選情卡` });
      return 'shared';
    } catch {
      /* 使用者取消 → 落到下載 */
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return 'downloaded';
}
