import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Cand, type Party, partyLabel } from './lib/candidates';
import { DAAN_2026, DAAN_META, type DaanCandidate } from './lib/daan2026';
import { CHANGHUA_2026, CHANGHUA_META, CHANGHUA_TOWNS } from './lib/changhua2026';
import { SIGNUP_FORM } from './PollCard';

// VoteMatch — 里長候選人「政治美感」左滑／右滑／收藏（計算機頁面二）
//
// 區域：臺北市大安區（登記冊 115/09/04，53 里 86 位）＋ 彰化縣 26 鄉鎮市（概況表 115/09/04，1,040 位），
// 以 ?r=<鄉鎮市> 切換，預設大安區。每個區域各自一副牌、各自記錄。
// 只有候選人公開頁面／本人提供的卡片有照片與文案，其餘留空：正面「大字姓氏看板」、背面「資料待候選人提供」＋補資料 CTA。
//
// 法律定調（勿改動）：
//  - 問的是「這張卡的政治美感你有沒有感覺」（印象／美感），不是候選人支持度調查。
//  - 你的滑動與收藏只存在自己的裝置（localStorage），不上傳、不統計、不公布任何比例。
//  - 「登記序號」不是號次；正式候選人與號次以選委會公告為準。
//  - 選前十日（11/18 起）本頁不新增任何統計顯示。

const LINE_URL = 'https://line.me/R/ti/p/%40449kyids';
const SWIPE_THRESHOLD = 100;

type Verdict = 'like' | 'skip';
interface Store { idx: number; verdicts: Record<string, Verdict>; saved: string[]; order: string[] }

interface Region { key: string; county: string; town: string; label: string; source: string; cards: Cand[] }

const daanToCand = (d: DaanCandidate): Cand => ({ ...d, county: '臺北市', town: '大安區', village: `${d.li}里` });

const REGIONS: Region[] = [
  { key: '大安區', county: '臺北市', town: '大安區', label: '臺北市大安區', source: `${DAAN_META.source}（製表 ${DAAN_META.compiledAt}）`, cards: DAAN_2026.map(daanToCand) },
  ...CHANGHUA_TOWNS.map((t) => ({
    key: t,
    county: '彰化縣',
    town: t,
    label: `彰化縣${t}`,
    source: `${CHANGHUA_META.source}（製表 ${CHANGHUA_META.compiledAt}）`,
    cards: CHANGHUA_2026.filter((c) => c.town === t),
  })),
];

function regionFromUrl(): Region {
  const r = new URLSearchParams(location.search).get('r');
  return REGIONS.find((x) => x.key === r) ?? REGIONS[0];
}

interface Palette { bg: string; bg2: string; fg: string; accent: string }
const PARTY_PALETTE: Partial<Record<Party, Palette>> = {
  DPP: { bg: '#1b7a3a', bg2: '#0f5527', fg: '#ffffff', accent: '#f0c14b' },
  KMT: { bg: '#10269e', bg2: '#0a1a6b', fg: '#ffffff', accent: '#f0c14b' },
  TPP: { bg: '#1f9e9e', bg2: '#157070', fg: '#ffffff', accent: '#ffffff' },
  NPP: { bg: '#c9a400', bg2: '#8f7400', fg: '#0b1f3a', accent: '#0b1f3a' },
};
const IND_PALETTES: Palette[] = [
  { bg: '#1e5045', bg2: '#123128', fg: '#f6f1e7', accent: '#f0c14b' },
  { bg: '#0b1f3a', bg2: '#061229', fg: '#f6f1e7', accent: '#f0c14b' },
  { bg: '#c0392b', bg2: '#8e2a1f', fg: '#fff8ee', accent: '#f0c14b' },
  { bg: '#3d2b5a', bg2: '#26183a', fg: '#f6f1e7', accent: '#f0c14b' },
];

function storeKey(r: Region) {
  return `cov-votematch-${r.key}-v1`;
}
function readStore(r: Region): Store | null {
  try {
    const s = localStorage.getItem(storeKey(r));
    return s ? (JSON.parse(s) as Store) : null;
  } catch {
    return null;
  }
}
function writeStore(r: Region, s: Store) {
  try {
    localStorage.setItem(storeKey(r), JSON.stringify(s));
  } catch {
    /* 私密視窗：本次可玩，不記憶 */
  }
}

// ── 正面 ─────────────────────────────────────────────────
function Front({ c, p }: { c: Cand; p: Palette }) {
  if (c.front) {
    return (
      <div className="absolute inset-0 overflow-hidden bg-ink text-left">
        <img src={c.front} alt={`${c.name} 競選照片`} className="h-full w-full object-cover" draggable={false} />
        <div className="pointer-events-none absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0) 45%, rgba(0,0,0,.74) 100%)' }} />
        <span className="absolute right-3 top-3 rounded-full border border-white/50 bg-black/40 px-2.5 py-1 text-[11px] font-bold text-white">點一下翻面 ↻</span>
        <div className="absolute inset-x-0 bottom-0 p-5 text-white">
          <div className="font-serif text-[40px] font-black leading-none" style={{ textShadow: '0 2px 12px rgba(0,0,0,.4)' }}>{c.name}</div>
          <div className="mt-1.5 text-[12.5px] font-bold tracking-wider opacity-95">{partyLabel(c)} · {c.town}{c.village}</div>
          {c.tags && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {c.tags.map((t) => (
                <span key={t} className="rounded-full border border-white/40 bg-white/15 px-2 py-0.5 text-[11px] font-bold">{t}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }
  const surname = [...c.name][0] ?? '';
  return (
    <div className="absolute inset-0 overflow-hidden text-left" style={{ background: `linear-gradient(160deg, ${p.bg} 0%, ${p.bg2} 100%)`, color: p.fg }}>
      <div className="pointer-events-none absolute inset-0 opacity-[0.12]" style={{ backgroundImage: `repeating-linear-gradient(135deg, ${p.fg} 0 2px, transparent 2px 14px)` }} />
      <div className="absolute left-4 top-4" style={{ writingMode: 'vertical-rl' }}>
        <span className="border-[2.5px] px-1.5 py-2 font-serif text-[16px] font-black tracking-[0.35em]" style={{ borderColor: p.fg }}>
          {c.town} {c.village}
        </span>
      </div>
      <span className="absolute right-3 top-3 rounded-full border px-2.5 py-1 text-[11px] font-bold" style={{ borderColor: p.fg + '88' }}>點一下翻面 ↻</span>
      <div className="absolute left-1/2 top-[26%] -translate-x-1/2">
        <div className="relative flex h-40 w-40 items-center justify-center rounded-full border-[5px] shadow-[0_18px_40px_rgba(0,0,0,0.35)]" style={{ borderColor: p.accent, background: p.bg2 }}>
          <span className="font-serif text-[104px] font-black leading-none" style={{ color: p.fg }}>{surname}</span>
          <span className="absolute -bottom-2 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-widest" style={{ background: p.accent, color: p.bg2 }}>照片待提供</span>
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 p-5">
        <div className="font-serif text-[56px] font-black leading-none tracking-[0.04em]" style={{ textShadow: '0 4px 0 rgba(0,0,0,0.25)' }}>{c.name}</div>
        <div className="mt-2 flex items-center gap-2 text-[12px] font-bold">
          <span className="rounded-sm border px-1.5 py-0.5" style={{ borderColor: p.fg + '88' }}>{partyLabel(c)}</span>
          <span className="opacity-80">登記序號 {c.regNo}（非號次）</span>
        </div>
        <div className="mt-3 -mx-5 -mb-5 px-5 py-2.5 font-serif text-[14px] font-black tracking-wider" style={{ background: p.accent, color: p.bg2 }}>
          115 年登記候選人 · 資料待補
        </div>
      </div>
    </div>
  );
}

// ── 背面 ─────────────────────────────────────────────────
function Back({ c, p }: { c: Cand; p: Palette }) {
  const hasContent = !!(c.slogans?.length || c.tagline || c.titles || c.background);
  return (
    <div className="absolute inset-0 overflow-auto bg-paper text-left text-ink" style={{ transform: 'rotateY(180deg)' }}>
      <div className="h-3" style={{ background: p.bg }} />
      <div className="p-4">
        <div className="flex items-center gap-3">
          {c.avatar ? (
            <img src={c.avatar} alt="" className="h-12 w-12 rounded-full border-2 border-paper-line object-cover" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full font-serif text-[22px] font-black" style={{ background: p.bg, color: p.fg }}>{[...c.name][0]}</div>
          )}
          <div>
            <div className="font-serif text-[24px] font-black leading-tight">
              {c.name}{c.nick ? `（${c.nick}）` : ''}
            </div>
            <div className="text-[11px] font-bold text-ink-soft">{partyLabel(c)} · {c.county}{c.town}{c.village} · 登記序號 {c.regNo}（非號次）</div>
          </div>
        </div>

        {hasContent ? (
          <>
            {c.titles && <div className="mt-3 inline-block rounded-md bg-ink px-3 py-1.5 font-serif text-[15px] font-black text-gold-soft">{c.titles}</div>}
            <div className="mt-3 text-[11px] font-bold tracking-[0.3em] text-ink-soft">候選人這麼說</div>
            {c.slogans?.map((s) => (
              <p key={s} className="mt-2 border-l-[3px] border-ink pl-3 font-serif text-[16px] font-black leading-snug">{s}</p>
            ))}
            {c.tagline && <p className="mt-2 border-l-[3px] border-campaign pl-3 font-serif text-[17px] font-black leading-snug">{c.tagline}</p>}
            {c.background && (
              <>
                <div className="mt-3 text-[11px] font-bold tracking-[0.3em] text-ink-soft">背景</div>
                <p className="mt-1 text-[13px] leading-relaxed">{c.background}</p>
              </>
            )}
            {c.source && <p className="mt-3 text-[10.5px] leading-relaxed text-ink-soft/80">來源：{c.source}</p>}
          </>
        ) : (
          <>
            <div className="mt-4 border-[2.5px] border-dashed border-ink/40 p-4 text-center">
              <div className="font-serif text-[18px] font-black">政見・背景・特色</div>
              <div className="mt-1 text-[13px] text-ink-soft">待候選人提供</div>
            </div>
            <p className="mt-3 text-[12.5px] leading-relaxed text-ink-soft">
              這張卡目前只有登記冊上的名字。你是 {c.name} 本人或團隊嗎？把照片、一句話、政見丟給我們，卡片就會更新。
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[12.5px] font-bold">
              <a href={SIGNUP_FORM} target="_blank" rel="noreferrer" className="border-[2.5px] border-ink bg-gold px-2 py-2 text-center">我是候選人，補資料</a>
              <a href={LINE_URL} target="_blank" rel="noreferrer" className="border-[2.5px] border-ink/40 px-2 py-2 text-center">加 LINE 聊聊</a>
            </div>
          </>
        )}
        <p className="mt-4 text-center text-[12px] font-bold text-ink-soft">點一下翻回正面</p>
      </div>
    </div>
  );
}

// ── 主程式 ───────────────────────────────────────────────
export default function VoteMatchApp() {
  const [region, setRegion] = useState<Region>(() => regionFromUrl());
  const cards = useMemo(() => {
    let seq = 0;
    return region.cards.map((c) => ({ c, p: PARTY_PALETTE[c.party] ?? IND_PALETTES[seq++ % IND_PALETTES.length] }));
  }, [region]);

  const [idx, setIdx] = useState(0);
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [saved, setSaved] = useState<string[]>([]);
  const [flipped, setFlipped] = useState(false);
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const [leaving, setLeaving] = useState<Verdict | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const startRef = useRef<{ x: number; y: number; id: number } | null>(null);
  const movedRef = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);

  // 切區：還原該區進度，並同步網址 ?r=
  useEffect(() => {
    loadedRef.current = false;
    const s = readStore(region);
    if (s && s.order.length === cards.length && s.order.every((id, i) => id === cards[i].c.id)) {
      setIdx(Math.min(s.idx, cards.length));
      setVerdicts(s.verdicts);
      setSaved(s.saved ?? []);
    } else {
      setIdx(0);
      setVerdicts({});
      setSaved([]);
    }
    setFlipped(false);
    const u = new URL(location.href);
    if (region === REGIONS[0]) u.searchParams.delete('r');
    else u.searchParams.set('r', region.key);
    history.replaceState(null, '', u.toString());
    loadedRef.current = true;
  }, [region, cards]);
  useEffect(() => {
    if (!loadedRef.current) return;
    writeStore(region, { idx, verdicts, saved, order: cards.map((x) => x.c.id) });
  }, [idx, verdicts, saved, cards, region]);

  const current = cards[idx];
  const done = idx >= cards.length;

  const commit = useCallback(
    (v: Verdict) => {
      if (!current || leaving) return;
      setLeaving(v);
      setDrag(null);
      window.setTimeout(() => {
        setVerdicts((m) => ({ ...m, [current.c.id]: v }));
        setIdx((i) => i + 1);
        setFlipped(false);
        setLeaving(null);
      }, 320);
    },
    [current, leaving],
  );
  const save = useCallback(() => {
    if (!current) return;
    setSaved((s) => (s.includes(current.c.id) ? s : [...s, current.c.id]));
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 700);
  }, [current]);
  const undo = useCallback(() => {
    if (idx === 0 || leaving) return;
    const prev = cards[idx - 1];
    setVerdicts((m) => {
      const n = { ...m };
      delete n[prev.c.id];
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (done || (e.target as HTMLElement | null)?.tagName === 'SELECT') return;
      if (e.key === 'ArrowLeft') commit('skip');
      else if (e.key === 'ArrowRight') commit('like');
      else if (e.key === 'ArrowUp' || e.key === 's') save();
      else if (e.key === ' ') {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === 'Backspace') undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commit, save, undo, done]);

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
      setFlipped((f) => !f);
      return;
    }
    const dx = e.clientX - s.x;
    if (Math.abs(dx) > SWIPE_THRESHOLD) commit(dx > 0 ? 'like' : 'skip');
    else setDrag(null);
  };

  const dx = drag?.dx ?? 0;
  const dy = drag?.dy ?? 0;
  const likeOpacity = Math.min(1, Math.max(0, dx / SWIPE_THRESHOLD));
  const skipOpacity = Math.min(1, Math.max(0, -dx / SWIPE_THRESHOLD));
  const flyX = leaving === 'like' ? 600 : leaving === 'skip' ? -600 : 0;
  const cardStyle: React.CSSProperties = leaving
    ? { transform: `translate(${flyX}px, ${dy}px) rotate(${leaving === 'like' ? 20 : -20}deg)`, opacity: 0, transition: 'transform 320ms ease-in, opacity 320ms ease-in' }
    : drag
      ? { transform: `translate(${dx}px, ${dy * 0.35}px) rotate(${dx / 18}deg)`, transition: 'none' }
      : { transform: 'translate(0,0) rotate(0)', transition: 'transform 260ms cubic-bezier(.2,.9,.3,1.2)' };

  const likeCount = Object.values(verdicts).filter((v) => v === 'like').length;
  const villages = useMemo(() => new Set(cards.map((x) => x.c.village)).size, [cards]);
  const savedCards = saved.map((id) => cards.find((x) => x.c.id === id)).filter((x): x is (typeof cards)[number] => !!x);

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col px-4 pb-10 pt-5 font-sans text-ink select-none">
      <header className="flex items-center justify-between">
        <div>
          <div className="text-[11px] font-bold tracking-[0.3em] text-ink-soft">COV 里長練習生計畫 · 頁面二</div>
          <h1 className="font-serif text-[26px] font-black leading-tight">VoteMatch</h1>
        </div>
        <button onClick={() => setShowSaved(true)} className="border-[2.5px] border-ink bg-white px-2.5 py-1.5 text-[12px] font-bold shadow-[3px_3px_0_0_var(--color-ink)]">
          ⭐ {saved.length}
        </button>
      </header>

      {/* 區域切換 */}
      <label className="mt-3 flex items-center gap-2 text-[12px] font-bold text-ink-soft">
        <span className="shrink-0">區域</span>
        <select
          value={region.key}
          onChange={(e) => setRegion(REGIONS.find((r) => r.key === e.target.value) ?? REGIONS[0])}
          className="w-full border-[2.5px] border-ink bg-white px-2 py-1.5 font-serif text-[15px] font-black text-ink"
        >
          <optgroup label="臺北市">
            <option value={REGIONS[0].key}>大安區（{REGIONS[0].cards.length} 位）</option>
          </optgroup>
          <optgroup label="彰化縣">
            {REGIONS.slice(1).map((r) => (
              <option key={r.key} value={r.key}>{r.town}（{r.cards.length} 位）</option>
            ))}
          </optgroup>
        </select>
      </label>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
        {region.label} {villages} 里 · {cards.length} 位。<b className="text-ink">右滑＝有感</b>、<b className="text-ink">左滑＝略過</b>、<b className="text-ink">⭐ 收藏</b>，點一下翻到政見面。這是「政治美感」不是支持度；滑動只存在你的手機。
      </p>

      <div className="mt-3">
        <div className="flex items-center justify-between text-[12px] font-bold text-ink-soft">
          <span>第 {Math.min(idx + 1, cards.length)} / {cards.length} 張</span>
          <span>有感 {likeCount} · 收藏 {saved.length}</span>
        </div>
        <div className="mt-1 h-1.5 w-full bg-paper-line">
          <div className="h-full bg-campaign transition-[width]" style={{ width: `${cards.length ? (Math.min(idx, cards.length) / cards.length) * 100 : 0}%` }} />
        </div>
      </div>

      {done && <Summary region={region} cards={cards.map((x) => x.c)} verdicts={verdicts} saved={saved} onReset={reset} />}

      {!done && (
        <div className="relative mt-4 aspect-[5/7] w-full" style={{ perspective: '1400px', touchAction: 'none' }}>
          {[2, 1].map((k) => {
            const x = cards[idx + k];
            if (!x) return null;
            return (
              <div key={x.c.id} className="absolute inset-0 overflow-hidden border-[3px] border-ink shadow-[6px_6px_0_0_var(--color-ink)]" style={{ transform: `translateY(${k * 10}px) scale(${1 - k * 0.04})`, transformOrigin: 'top center' }}>
                <Front c={x.c} p={x.p} />
              </div>
            );
          })}
          {current && (
            <div ref={cardRef} className="absolute inset-0 cursor-grab active:cursor-grabbing" style={cardStyle} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { startRef.current = null; setDrag(null); }}>
              <div className="relative h-full w-full border-[3px] border-ink shadow-[6px_6px_0_0_var(--color-ink)]" style={{ transformStyle: 'preserve-3d', transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)', transition: 'transform 420ms cubic-bezier(.3,.8,.3,1)' }}>
                <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden' }}>
                  <Front c={current.c} p={current.p} />
                </div>
                <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
                  <div className="absolute inset-0" style={{ transform: 'rotateY(180deg)' }}>
                    <Back c={current.c} p={current.p} />
                  </div>
                </div>
              </div>
              <div className="pointer-events-none absolute left-5 top-8 -rotate-12 border-[4px] border-gold-soft px-3 py-1 font-serif text-[30px] font-black tracking-[0.2em] text-gold-soft" style={{ opacity: likeOpacity, textShadow: '0 2px 0 rgba(0,0,0,.4)' }}>有感</div>
              <div className="pointer-events-none absolute right-5 top-8 rotate-12 border-[4px] border-paper px-3 py-1 font-serif text-[30px] font-black tracking-[0.2em] text-paper" style={{ opacity: skipOpacity, textShadow: '0 2px 0 rgba(0,0,0,.4)' }}>略過</div>
              <div className="pointer-events-none absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 -rotate-6 border-[4px] border-gold bg-ink/70 px-4 py-1 font-serif text-[28px] font-black tracking-[0.2em] text-gold transition-opacity" style={{ opacity: savedFlash ? 1 : 0 }}>⭐ 收藏</div>
            </div>
          )}
        </div>
      )}

      {!done && current && (
        <div className="mt-5 flex items-center justify-center gap-3">
          <button onClick={() => commit('skip')} className="flex h-16 w-16 items-center justify-center border-[3px] border-ink bg-white font-serif text-[26px] font-black shadow-[4px_4px_0_0_var(--color-ink)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none" aria-label="略過">✕</button>
          <button onClick={undo} disabled={idx === 0} className="flex h-11 w-11 items-center justify-center border-[2.5px] border-ink/40 bg-paper text-[18px] font-black text-ink-soft disabled:opacity-30" aria-label="復原">↩</button>
          <button onClick={save} className="flex h-14 w-14 items-center justify-center border-[3px] border-ink bg-paper text-[22px] shadow-[4px_4px_0_0_var(--color-ink)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none" aria-label="收藏">⭐</button>
          <button onClick={() => setFlipped((f) => !f)} className="flex h-11 w-11 items-center justify-center border-[2.5px] border-ink/40 bg-paper text-[16px] font-black text-ink-soft" aria-label="翻面">⇄</button>
          <button onClick={() => commit('like')} className="flex h-16 w-16 items-center justify-center border-[3px] border-ink bg-gold font-serif text-[26px] font-black shadow-[4px_4px_0_0_var(--color-ink)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none" aria-label="有感">♥</button>
        </div>
      )}
      {!done && <p className="mt-3 text-center text-[11px] text-ink-soft/70">鍵盤：← 略過 · → 有感 · ↑ 收藏 · 空白鍵翻面 · Backspace 復原</p>}

      <footer className="mt-auto pt-8 text-[11px] leading-relaxed text-ink-soft/70">
        資料：{region.source}。「登記序號」不是號次；正式候選人與號次以選委會公告為準。
        照片與政見僅放候選人公開頁面或本人提供之內容，其餘卡片留空待補。本頁問的是政治美感／印象，不是支持度調查；你的滑動與收藏只存在你自己的手機裡，不上傳、不統計、不公布。
      </footer>

      {showSaved && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45" onClick={() => setShowSaved(false)}>
          <div className="max-h-[70vh] w-full max-w-md overflow-auto border-t-[3px] border-ink bg-paper p-4 text-left" onClick={(e) => e.stopPropagation()}>
            <div className="font-serif text-[20px] font-black">⭐ 你的收藏 · {region.town}</div>
            {savedCards.length === 0 ? (
              <p className="mt-2 text-[13px] text-ink-soft">還沒有收藏。按 ⭐ 把候選人存起來。</p>
            ) : (
              <ul className="mt-2 divide-y divide-paper-line">
                {savedCards.map((x) => (
                  <li key={x.c.id} className="flex items-center gap-3 py-2">
                    {x.c.avatar ? <img src={x.c.avatar} alt="" className="h-10 w-10 rounded-full object-cover" /> : <span className="flex h-10 w-10 items-center justify-center rounded-full font-serif font-black" style={{ background: x.p.bg, color: x.p.fg }}>{[...x.c.name][0]}</span>}
                    <div>
                      <div className="font-serif font-black">{x.c.name}</div>
                      <div className="text-[11px] text-ink-soft">{partyLabel(x.c)} · {x.c.village}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <button onClick={() => setShowSaved(false)} className="mt-3 w-full border-[2.5px] border-ink/40 py-2 text-[13px] font-bold text-ink-soft">關閉</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Summary({ region, cards, verdicts, saved, onReset }: { region: Region; cards: Cand[]; verdicts: Record<string, Verdict>; saved: string[]; onReset: () => void }) {
  const liked = cards.filter((c) => verdicts[c.id] === 'like');
  const byVillage = new Map<string, Cand[]>();
  for (const c of liked) {
    if (!byVillage.has(c.village)) byVillage.set(c.village, []);
    byVillage.get(c.village)!.push(c);
  }
  const villagesTotal = new Set(cards.map((c) => c.village)).size;
  return (
    <div className="mt-4 border-[3px] border-ink bg-white p-5 shadow-[6px_6px_0_0_var(--color-ink)] text-left">
      <div className="text-[11px] font-bold tracking-[0.3em] text-ink-soft">VoteMatch · {region.label} 結算</div>
      <div className="mt-2 font-serif text-[40px] font-black leading-none">
        {liked.length}<span className="ml-1 text-[18px]">/ {cards.length} 張有感</span>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
        {villagesTotal} 個里，你對 {byVillage.size} 個里的候選人有感；收藏了 {saved.length} 位。
      </p>
      {liked.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {[...byVillage].map(([village, cs]) => (
            <li key={village} className="flex items-baseline gap-2 border-b border-paper-line pb-1.5 text-[14px]">
              <span className="w-16 shrink-0 font-bold text-ink-soft">{village}</span>
              <span className="font-serif font-black">{cs.map((c) => c.name).join('、')}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 border-[3px] border-ink bg-ink p-4 text-paper">
        <div className="text-[11px] font-bold tracking-[0.3em] text-gold-soft">民國 115 年 · 11/28 投票</div>
        <div className="mt-1 font-serif text-[22px] font-black leading-tight">你也是候選人？讓你的卡片有內容。</div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[13px] font-bold">
          <a href="./" className="border-[2.5px] border-gold-soft bg-gold/20 px-2 py-2 text-center">算我的里要幾票</a>
          <a href={SIGNUP_FORM} target="_blank" rel="noreferrer" className="border-[2.5px] border-paper/60 px-2 py-2 text-center">報名數位競選總部</a>
        </div>
      </div>
      <button onClick={onReset} className="mt-4 w-full border-[2.5px] border-ink/40 py-2 text-[13px] font-bold text-ink-soft">再滑一次</button>
    </div>
  );
}
