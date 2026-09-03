import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadCounty, type VillageRow } from './lib/data';
import type { Candidate, ElectionResult } from './lib/calc';
import { SIGNUP_FORM } from './PollCard';

// 看板牆 — 里長候選人「左滑右滑」（政治美學版）
//
// 玩法：一張卡＝一面看板。左滑「沒印象」、右滑「有印象」，點一下翻到資料面。
// 示範資料：彰化市東區 22 里、111 年（2022）里長選舉全部候選人（中選會公開資料）。
//
// 法律定調（勿改動）：
//  - 這不是候選人支持度調查——問的是「你對這面看板有沒有印象」（知名度，非偏好）。
//  - 結果只存在使用者自己的裝置（localStorage），不上傳、不統計、不公布任何比例。
//  - 115 年正式候選人名單以選委會公告為準；本頁用上一屆公開資料當模板示範。
//
// 設計語言：臺灣路邊競選看板——超大姓名、直書里名、號次圓、斜紋底、燙金當選帶。
// 沒有候選人照片時，以「大字姓氏」作為肖像位（姓氏看板本身就是一種在地政治美學）。

const COUNTY_CODE = '10007'; // 彰化縣
// 彰化市東區 22 里＝中選會 region_code 10007_010_0050 ～ 0071（含罕字「寶廍里」，
// 用代碼而非名稱比對，避免私用區字元漏抓）
const EAST_CODE_MIN = 50;
const EAST_CODE_MAX = 71;
const LINE_URL = 'https://line.me/R/ti/p/%40449kyids';
const STORE_KEY = 'cov-swipe-east-v1';
const SWIPE_THRESHOLD = 90; // px；超過即判定滑出

type Verdict = 'yes' | 'no';

interface Card {
  id: string;
  village: string;
  regionCode: string;
  year: number;
  cand: Candidate;
  rank: number; // 該里得票名次（1 = 最高票）
  nCand: number;
  sharePct: number;
  electorate?: number;
  turnout?: number;
  uncontested: boolean;
  tie: boolean;
  palette: Palette;
}

interface Palette { bg: string; bg2: string; fg: string; accent: string; label: string }

// 有黨籍者用黨色（並標示黨名）；無黨籍輪用計算機自家色盤，不暗示任何政黨
const PARTY_PALETTE: Record<string, Palette> = {
  DPP: { bg: '#1b7a3a', bg2: '#0f5527', fg: '#ffffff', accent: '#f0c14b', label: '民主進步黨' },
  KMT: { bg: '#10269e', bg2: '#0a1a6b', fg: '#ffffff', accent: '#f0c14b', label: '中國國民黨' },
  TPP: { bg: '#1f9e9e', bg2: '#157070', fg: '#ffffff', accent: '#ffffff', label: '台灣民眾黨' },
  NPP: { bg: '#c9a400', bg2: '#8f7400', fg: '#0b1f3a', accent: '#0b1f3a', label: '時代力量' },
  TSU: { bg: '#a8791c', bg2: '#7a5711', fg: '#ffffff', accent: '#ffffff', label: '台灣團結聯盟' },
};
const IND_PALETTES: Palette[] = [
  { bg: '#0b1f3a', bg2: '#061229', fg: '#f6f1e7', accent: '#f0c14b', label: '無黨籍' },
  { bg: '#c0392b', bg2: '#8e2a1f', fg: '#fff8ee', accent: '#f0c14b', label: '無黨籍' },
  { bg: '#1e5045', bg2: '#123128', fg: '#f6f1e7', accent: '#f0c14b', label: '無黨籍' },
  { bg: '#3d2b5a', bg2: '#26183a', fg: '#f6f1e7', accent: '#f0c14b', label: '無黨籍' },
];

const nf = (n: number) => n.toLocaleString('zh-TW');
const roc = (y: number) => y - 1911;

// 罕字顯示：中選會資料用私用區字元（手機字型顯示成豆腐），畫面上換成正字
const VILLAGE_DISPLAY: Record<string, string> = { '10007_010_0059': '寶廍里' };
const displayVillage = (v: VillageRow) => VILLAGE_DISPLAY[v.region_code] ?? v.village;

function buildCards(rows: VillageRow[]): Card[] {
  const east = rows
    .filter((v) => {
      const m = /^10007_010_(\d{4})$/.exec(v.region_code);
      if (!m) return false;
      const n = Number(m[1]);
      return n >= EAST_CODE_MIN && n <= EAST_CODE_MAX;
    })
    .sort((a, b) => a.region_code.localeCompare(b.region_code));
  const cards: Card[] = [];
  let indSeq = 0;
  for (const v of east) {
    const e: ElectionResult | undefined = v.history?.[0];
    if (!e || e.candidates.length === 0) continue;
    const total = e.candidates.reduce((s, c) => s + c.votes, 0);
    const sorted = [...e.candidates].sort((a, b) => b.votes - a.votes);
    sorted.forEach((c, i) => {
      const party = (c.party ?? 'IND').toUpperCase();
      const palette = PARTY_PALETTE[party] ?? IND_PALETTES[indSeq++ % IND_PALETTES.length];
      cards.push({
        id: `${v.region_code}-${c.name}`,
        village: displayVillage(v),
        regionCode: v.region_code,
        year: e.year,
        cand: c,
        rank: i + 1,
        nCand: sorted.length,
        sharePct: total > 0 ? Math.round((c.votes / total) * 1000) / 10 : 0,
        electorate: e.electorate,
        turnout: e.turnout,
        uncontested: !!e.uncontested,
        tie: !!e.tie,
        palette,
      });
    });
  }
  return cards;
}

// ── 本機紀錄（不上傳） ─────────────────────────────────────
interface Store { idx: number; verdicts: Record<string, Verdict>; order: string[] }
function readStore(): Store | null {
  try {
    const s = localStorage.getItem(STORE_KEY);
    return s ? (JSON.parse(s) as Store) : null;
  } catch {
    return null;
  }
}
function writeStore(s: Store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* 私密視窗等情況：本次仍可玩，只是不記憶 */
  }
}

// ── 看板正面 ─────────────────────────────────────────────
function BillboardFront({ card }: { card: Card }) {
  const { palette: p, cand } = card;
  const surname = [...cand.name][0] ?? '';
  const given = [...cand.name].slice(1).join('');
  return (
    <div
      className="absolute inset-0 overflow-hidden text-left"
      style={{
        background: `linear-gradient(160deg, ${p.bg} 0%, ${p.bg2} 100%)`,
        color: p.fg,
      }}
    >
      {/* 斜紋底：看板印刷感 */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage: `repeating-linear-gradient(135deg, ${p.fg} 0 2px, transparent 2px 14px)`,
        }}
      />
      {/* 網點：左下大圓 */}
      <div
        className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full opacity-25"
        style={{ backgroundImage: `radial-gradient(${p.fg} 1.4px, transparent 1.6px)`, backgroundSize: '9px 9px' }}
      />

      {/* 左側直書里名 */}
      <div
        className="absolute left-4 top-4 flex items-start gap-2"
        style={{ writingMode: 'vertical-rl' }}
      >
        <span
          className="border-[2.5px] px-1.5 py-2 font-serif text-[17px] font-black tracking-[0.35em]"
          style={{ borderColor: p.fg }}
        >
          彰化市 {card.village}
        </span>
      </div>

      {/* 右上年份章 */}
      <div
        className="absolute right-4 top-4 flex h-16 w-16 flex-col items-center justify-center rounded-full border-[3px] font-serif font-black leading-none"
        style={{ borderColor: p.accent, color: p.accent }}
      >
        <span className="text-[11px] tracking-widest">民國</span>
        <span className="text-[24px]">{roc(card.year)}</span>
        <span className="text-[9px] tracking-widest">里長選舉</span>
      </div>

      {/* 肖像位：大字姓氏（無照片時的在地政治美學） */}
      <div className="absolute left-1/2 top-[27%] -translate-x-1/2">
        <div
          className="relative flex h-40 w-40 items-center justify-center rounded-full border-[5px] shadow-[0_18px_40px_rgba(0,0,0,0.35)]"
          style={{ borderColor: p.accent, background: `radial-gradient(circle at 35% 30%, ${p.fg}22, transparent 60%), ${p.bg2}` }}
        >
          <span className="font-serif text-[104px] font-black leading-none" style={{ color: p.fg }}>
            {surname}
          </span>
          <span
            className="absolute -bottom-2 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-widest"
            style={{ background: p.accent, color: p.bg2 }}
          >
            候選人照片位
          </span>
        </div>
      </div>

      {/* 底部：姓名 + 黨籍 + 結果帶 */}
      <div className="absolute inset-x-0 bottom-0 p-5">
        <div className="flex items-end gap-2">
          <span className="font-serif text-[64px] font-black leading-none tracking-[0.04em]" style={{ textShadow: '0 4px 0 rgba(0,0,0,0.25)' }}>
            {surname}
            {given}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2 text-[12px] font-bold">
          <span className="rounded-sm border px-1.5 py-0.5" style={{ borderColor: p.fg + '88' }}>
            {p.label}
          </span>
          {cand.birthYear && <span className="opacity-80">民國 {roc(cand.birthYear)} 年生</span>}
        </div>
        <div
          className="mt-3 -mx-5 -mb-5 flex items-center justify-between px-5 py-2.5 font-serif text-[15px] font-black tracking-wider"
          style={{ background: p.accent, color: p.bg2 }}
        >
          <span>
            {card.uncontested
              ? '同額競選 · 當選'
              : cand.won
                ? card.tie
                  ? '同票抽籤 · 當選'
                  : '最高票當選'
                : `第 ${card.rank} 高票`}
          </span>
          <span className="tabular-nums">{nf(cand.votes)} 票 · {card.sharePct}%</span>
        </div>
      </div>
    </div>
  );
}

// ── 資料背面 ─────────────────────────────────────────────
function BillboardBack({ card }: { card: Card }) {
  const { cand, palette: p } = card;
  const age = cand.birthYear ? 2026 - cand.birthYear : undefined;
  const rows: Array<[string, string]> = [
    ['里', `彰化市 ${card.village}`],
    ['屆別', `民國 ${roc(card.year)} 年（${card.year}）`],
    ['得票', `${nf(cand.votes)} 票（${card.sharePct}%）`],
    ['結果', card.uncontested ? '同額競選當選' : cand.won ? (card.tie ? '同票抽籤當選' : '當選') : `${card.nCand} 人中第 ${card.rank} 高票`],
    ['選舉人數', card.electorate ? `${nf(card.electorate)} 人` : '—'],
    ['投票率', card.turnout ? `${Math.round(card.turnout * 1000) / 10}%` : '—'],
    ['黨籍', p.label],
    ['年齡（115 年）', age ? `約 ${age} 歲` : '—'],
  ];
  return (
    <div className="absolute inset-0 overflow-hidden bg-paper text-left text-ink" style={{ transform: 'rotateY(180deg)' }}>
      <div className="h-3" style={{ background: p.bg }} />
      <div className="p-4">
        <div className="text-[11px] font-bold tracking-[0.3em] text-ink-soft">資料面 · 中選會公開資料</div>
        <div className="mt-0.5 font-serif text-[30px] font-black leading-tight">{cand.name}</div>
        <dl className="mt-3 divide-y divide-paper-line border-y-[2px] border-ink">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3 py-1.5 text-[14px]">
              <dt className="shrink-0 font-bold text-ink-soft">{k}</dt>
              <dd className="text-right font-serif font-black tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[11px] leading-relaxed text-ink-soft/80">
          得票率＝該里所有候選人得票總和為分母。115 年正式候選人以選委會公告為準；本卡為上一屆公開資料。
        </p>
        <p className="mt-2 text-center text-[12px] font-bold text-ink-soft">點一下翻回看板</p>
      </div>
    </div>
  );
}

// ── 主程式 ───────────────────────────────────────────────
export default function SwipeApp() {
  const [rows, setRows] = useState<VillageRow[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    loadCounty(COUNTY_CODE).then(setRows).catch((e: Error) => setErr(e.message));
  }, []);
  const cards = useMemo(() => (rows ? buildCards(rows) : []), [rows]);

  const [idx, setIdx] = useState(0);
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [flipped, setFlipped] = useState(false);
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const [leaving, setLeaving] = useState<Verdict | null>(null);
  const startRef = useRef<{ x: number; y: number; id: number } | null>(null);
  const movedRef = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // 還原上次進度（同一批卡片才還原）
  useEffect(() => {
    if (cards.length === 0) return;
    const s = readStore();
    if (s && s.order.length === cards.length && s.order.every((id, i) => id === cards[i].id)) {
      setIdx(Math.min(s.idx, cards.length));
      setVerdicts(s.verdicts);
    }
  }, [cards]);
  useEffect(() => {
    if (cards.length === 0) return;
    writeStore({ idx, verdicts, order: cards.map((c) => c.id) });
  }, [idx, verdicts, cards]);

  const current = cards[idx];
  const done = cards.length > 0 && idx >= cards.length;

  const commit = useCallback(
    (v: Verdict) => {
      if (!current || leaving) return;
      setLeaving(v);
      setDrag(null);
      window.setTimeout(() => {
        setVerdicts((m) => ({ ...m, [current.id]: v }));
        setIdx((i) => i + 1);
        setFlipped(false);
        setLeaving(null);
      }, 320);
    },
    [current, leaving],
  );

  const undo = useCallback(() => {
    if (idx === 0 || leaving) return;
    const prev = cards[idx - 1];
    setVerdicts((m) => {
      const n = { ...m };
      delete n[prev.id];
      return n;
    });
    setIdx((i) => i - 1);
    setFlipped(false);
  }, [idx, cards, leaving]);

  const reset = useCallback(() => {
    setIdx(0);
    setVerdicts({});
    setFlipped(false);
  }, []);

  // 鍵盤：← 沒印象、→ 有印象、空白鍵翻面、Backspace 復原
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (done) return;
      if (e.key === 'ArrowLeft') commit('no');
      else if (e.key === 'ArrowRight') commit('yes');
      else if (e.key === ' ') {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === 'Backspace') undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commit, undo, done]);

  // 拖曳：pointer events（手機／滑鼠通用）
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (leaving) return;
    startRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    movedRef.current = false;
    cardRef.current?.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = startRef.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) movedRef.current = true;
    if (movedRef.current) setDrag({ dx, dy });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = startRef.current;
    if (!s || s.id !== e.pointerId) return;
    startRef.current = null;
    if (!movedRef.current) {
      setFlipped((f) => !f); // 點一下＝翻面
      return;
    }
    const dx = e.clientX - s.x;
    if (Math.abs(dx) > SWIPE_THRESHOLD) commit(dx > 0 ? 'yes' : 'no');
    else setDrag(null);
  };

  // 卡片變形：拖曳中跟手；滑出時飛離
  const dx = drag?.dx ?? 0;
  const dy = drag?.dy ?? 0;
  const rot = dx / 18;
  const yesOpacity = Math.min(1, Math.max(0, dx / SWIPE_THRESHOLD));
  const noOpacity = Math.min(1, Math.max(0, -dx / SWIPE_THRESHOLD));
  const flyX = leaving === 'yes' ? 600 : leaving === 'no' ? -600 : 0;
  const cardStyle: React.CSSProperties = leaving
    ? { transform: `translate(${flyX}px, ${dy}px) rotate(${leaving === 'yes' ? 20 : -20}deg)`, opacity: 0, transition: 'transform 320ms ease-in, opacity 320ms ease-in' }
    : drag
      ? { transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg)`, transition: 'none' }
      : { transform: 'translate(0,0) rotate(0)', transition: 'transform 260ms cubic-bezier(.2,.9,.3,1.2)' };

  const yesCount = Object.values(verdicts).filter((v) => v === 'yes').length;
  const seen = Object.keys(verdicts).length;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col px-4 pb-10 pt-5 font-sans text-ink select-none">
      {/* 頁首 */}
      <header className="flex items-center justify-between">
        <div>
          <div className="text-[11px] font-bold tracking-[0.3em] text-ink-soft">COV 里長練習生計畫</div>
          <h1 className="font-serif text-[26px] font-black leading-tight">
            看板牆<span className="ml-2 text-[14px] font-bold text-campaign">彰化東區 22 里</span>
          </h1>
        </div>
        <a href="./east.html" className="text-[12px] font-bold text-ink-soft underline decoration-dotted underline-offset-2">
          東區選情站 →
        </a>
      </header>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
        一張卡一面看板。<b className="text-ink">右滑＝有印象</b>、<b className="text-ink">左滑＝沒印象</b>，點一下翻到資料面。
        看板的工作只有一件事：讓人記得名字。
      </p>

      {/* 進度 */}
      {cards.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[12px] font-bold text-ink-soft">
            <span>
              第 {Math.min(idx + 1, cards.length)} / {cards.length} 面
            </span>
            <span>有印象 {yesCount}</span>
          </div>
          <div className="mt-1 h-1.5 w-full bg-paper-line">
            <div className="h-full bg-campaign transition-[width]" style={{ width: `${(Math.min(idx, cards.length) / cards.length) * 100}%` }} />
          </div>
        </div>
      )}

      {/* 結算：走一般文流，整張含 CTA 都看得到 */}
      {done && <Summary cards={cards} verdicts={verdicts} onReset={reset} />}

      {/* 牌堆 */}
      {!done && (
      <div className="relative mt-4 aspect-[5/7] w-full" style={{ perspective: '1400px', touchAction: 'none' }}>
        {err && <div className="border-[3px] border-campaign bg-white p-4 text-[14px] font-bold text-campaign">{err}</div>}
        {!rows && !err && <div className="absolute inset-0 animate-pulse border-[3px] border-ink/20 bg-white/60" />}

        {!done &&
          [2, 1].map((k) => {
            const c = cards[idx + k];
            if (!c) return null;
            return (
              <div
                key={c.id}
                className="absolute inset-0 overflow-hidden border-[3px] border-ink shadow-[6px_6px_0_0_var(--color-ink)]"
                style={{ transform: `translateY(${k * 10}px) scale(${1 - k * 0.04})`, transformOrigin: 'top center' }}
              >
                <BillboardFront card={c} />
              </div>
            );
          })}

        {!done && current && (
          <div
            ref={cardRef}
            className="absolute inset-0 cursor-grab active:cursor-grabbing"
            style={cardStyle}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              startRef.current = null;
              setDrag(null);
            }}
          >
            <div
              className="relative h-full w-full border-[3px] border-ink shadow-[6px_6px_0_0_var(--color-ink)]"
              style={{
                transformStyle: 'preserve-3d',
                transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
                transition: 'transform 420ms cubic-bezier(.3,.8,.3,1)',
              }}
            >
              <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden' }}>
                <BillboardFront card={current} />
              </div>
              <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
                <div className="absolute inset-0" style={{ transform: 'rotateY(180deg)' }}>
                  <BillboardBack card={current} />
                </div>
              </div>
            </div>
            {/* 印章 */}
            <div
              className="pointer-events-none absolute left-5 top-8 -rotate-12 border-[4px] border-gold-soft px-3 py-1 font-serif text-[30px] font-black tracking-[0.2em] text-gold-soft"
              style={{ opacity: yesOpacity, textShadow: '0 2px 0 rgba(0,0,0,.4)' }}
            >
              有印象
            </div>
            <div
              className="pointer-events-none absolute right-5 top-8 rotate-12 border-[4px] border-paper px-3 py-1 font-serif text-[30px] font-black tracking-[0.2em] text-paper"
              style={{ opacity: noOpacity, textShadow: '0 2px 0 rgba(0,0,0,.4)' }}
            >
              沒印象
            </div>
          </div>
        )}
      </div>
      )}

      {/* 操作鈕 */}
      {!done && current && (
        <div className="mt-5 flex items-center justify-center gap-4">
          <button
            onClick={() => commit('no')}
            className="flex h-16 w-16 items-center justify-center border-[3px] border-ink bg-white font-serif text-[26px] font-black shadow-[4px_4px_0_0_var(--color-ink)] transition-transform active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
            aria-label="沒印象"
          >
            ✕
          </button>
          <button
            onClick={undo}
            disabled={idx === 0}
            className="flex h-11 w-11 items-center justify-center border-[2.5px] border-ink/40 bg-paper text-[18px] font-black text-ink-soft disabled:opacity-30"
            aria-label="復原"
          >
            ↩
          </button>
          <button
            onClick={() => setFlipped((f) => !f)}
            className="flex h-11 w-11 items-center justify-center border-[2.5px] border-ink/40 bg-paper text-[16px] font-black text-ink-soft"
            aria-label="翻面"
          >
            ⇄
          </button>
          <button
            onClick={() => commit('yes')}
            className="flex h-16 w-16 items-center justify-center border-[3px] border-ink bg-gold font-serif text-[26px] font-black shadow-[4px_4px_0_0_var(--color-ink)] transition-transform active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
            aria-label="有印象"
          >
            ✓
          </button>
        </div>
      )}
      {!done && (
        <p className="mt-3 text-center text-[11px] text-ink-soft/70">鍵盤：← 沒印象 · → 有印象 · 空白鍵翻面 · Backspace 復原</p>
      )}

      <footer className="mt-auto pt-8 text-[11px] leading-relaxed text-ink-soft/70">
        示範資料：彰化市東區 22 里、民國 111 年里長選舉全部候選人（中選會公開資料，得票由高到低）。
        本頁問的是「對看板有沒有印象」，不是支持度調查；你的滑動只存在你自己的手機裡，不上傳、不統計、不公布。
        115 年候選人名單以選委會公告為準。{seen > 0 && ` 已看 ${seen} 面。`}
      </footer>
    </div>
  );
}

// ── 結算 ─────────────────────────────────────────────────
function Summary({ cards, verdicts, onReset }: { cards: Card[]; verdicts: Record<string, Verdict>; onReset: () => void }) {
  const yes = cards.filter((c) => verdicts[c.id] === 'yes');
  const incumbents = yes.filter((c) => c.cand.won).length;
  const byVillage = new Map<string, Card[]>();
  for (const c of yes) {
    if (!byVillage.has(c.village)) byVillage.set(c.village, []);
    byVillage.get(c.village)!.push(c);
  }
  const villagesTotal = new Set(cards.map((c) => c.village)).size;
  return (
    <div className="mt-4 border-[3px] border-ink bg-white p-5 shadow-[6px_6px_0_0_var(--color-ink)] text-left">
      <div className="text-[11px] font-bold tracking-[0.3em] text-ink-soft">看板牆 · 結算</div>
      <div className="mt-2 font-serif text-[40px] font-black leading-none">
        {yes.length}
        <span className="ml-1 text-[18px]">/ {cards.length} 面有印象</span>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
        {villagesTotal} 個里裡，你記得 {byVillage.size} 個里的名字；有印象的人裡 {incumbents} 位是上屆當選人。
        {yes.length < cards.length / 3 && ' 大多數看板，四年後沒人記得——這正是看板最誠實的地方。'}
      </p>

      {yes.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {[...byVillage].map(([village, cs]) => (
            <li key={village} className="flex items-baseline gap-2 border-b border-paper-line pb-1.5 text-[14px]">
              <span className="w-14 shrink-0 font-bold text-ink-soft">{village}</span>
              <span className="font-serif font-black">
                {cs.map((c) => c.cand.name + (c.cand.won ? '（當選）' : '')).join('、')}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* 115 年換你上牆 */}
      <div className="mt-5 border-[3px] border-ink bg-ink p-4 text-paper">
        <div className="text-[11px] font-bold tracking-[0.3em] text-gold-soft">民國 115 年 · 11/28 投票</div>
        <div className="mt-1 font-serif text-[24px] font-black leading-tight">下一面看板，寫你的名字？</div>
        <p className="mt-2 text-[12px] leading-relaxed text-paper/80">先算你的里要幾票、保證金 3 萬能不能拿回來，再決定要不要上牆。</p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[13px] font-bold">
          <a href="./east.html" className="border-[2.5px] border-gold-soft bg-gold/20 px-2 py-2 text-center">算我的里要幾票</a>
          <a href={SIGNUP_FORM} target="_blank" rel="noreferrer" className="border-[2.5px] border-paper/60 px-2 py-2 text-center">
            報名數位競選總部
          </a>
        </div>
        <a href={LINE_URL} target="_blank" rel="noreferrer" className="mt-2 block text-center text-[12px] text-paper/70 underline decoration-dotted underline-offset-2">
          或先加 LINE 聊聊（不收費）
        </a>
      </div>

      <button onClick={onReset} className="mt-4 w-full border-[2.5px] border-ink/40 py-2 text-[13px] font-bold text-ink-soft">
        重看一次
      </button>
    </div>
  );
}
