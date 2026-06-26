import { useMemo, useState } from 'react';
import data from './data/villages.json';
import {
  depositThreshold,
  winInsight,
  competition,
  type Village,
  type Confidence,
  type OppTier,
} from './lib/calc';

type Row = Village & { county: string; district: string };
const villages = data.villages as Row[];
const meta = data.meta;
const DEFAULT = villages.find((v) => v.village === '西寶里') ?? villages[0];
const COUNTIES = [...new Set(villages.map((v) => v.county))];

const nf = (n: number) => n.toLocaleString('zh-TW');

const CONFIDENCE: Record<Confidence, { text: string; cls: string }> = {
  high: { text: '高可信 · 三屆完整紀錄', cls: 'bg-ink text-paper' },
  medium: { text: '中可信 · 一屆紀錄', cls: 'bg-gold text-ink' },
  low: { text: '低可信 · 僅人口推估', cls: 'bg-paper-line text-ink-soft' },
};

const TIER: Record<OppTier, { dot: string; cls: string; bar: string; sub: string }> = {
  大好機會: { dot: '🟢', cls: 'bg-emerald-600 text-white', bar: 'bg-emerald-500', sub: '新人空間很大' },
  有機會: { dot: '🟡', cls: 'bg-amber-400 text-ink', bar: 'bg-amber-400', sub: '勤跑就有機會' },
  拚拚看: { dot: '🟠', cls: 'bg-orange-500 text-white', bar: 'bg-orange-500', sub: '要下功夫衝高基本盤' },
  硬仗: { dot: '🔴', cls: 'bg-rose-600 text-white', bar: 'bg-rose-600', sub: '現任人氣穩固' },
  資料不足: { dot: '⚪', cls: 'bg-paper-line text-ink-soft', bar: 'bg-paper-line', sub: '資料補充中' },
};

// 政黨 → 顏色 + 名稱（里長多為無黨籍，偶有政黨）
const PARTY: Record<string, { dot: string; label: string }> = {
  KMT: { dot: '#1f5fb0', label: '國民黨' },
  DPP: { dot: '#1a8a44', label: '民進黨' },
  TPP: { dot: '#27a3a0', label: '民眾黨' },
  NPP: { dot: '#b59a06', label: '時代力量' },
  PFP: { dot: '#e07b1a', label: '親民黨' },
  IND: { dot: '#9a958a', label: '無黨籍' },
};
const party = (p?: string) => PARTY[p ?? 'IND'] ?? { dot: '#9a958a', label: p || '無黨籍' };

// 圈選打勾 蓋章符號（退保證金卡用）
function BallotStamp({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} fill="none" stroke="currentColor" aria-hidden="true">
      <circle cx="50" cy="50" r="38" strokeWidth="6" />
      <path d="M33 52 l12 13 l23 -30" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// 選舉圈選章符號（紅圓圈＋貫穿直線＋往左下斜線；圓頭線條、整體透明避免疊加變深）
function ElectionStamp({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="7"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="50" cy="50" r="40" />
      <line x1="50" y1="10" x2="50" y2="90" />
      <line x1="50" y1="50" x2="22" y2="78" />
    </svg>
  );
}

type Opt = string | { value: string; label: string };
function Dropdown({
  value,
  onChange,
  options,
  big,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Opt[];
  big?: boolean;
  label: string;
}) {
  return (
    <div className="relative">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full cursor-pointer appearance-none border-[3px] border-ink bg-white pr-10 pl-4 font-serif font-black text-ink focus:border-campaign focus:outline-none ${big ? 'py-3.5 text-xl' : 'py-3 text-base'}`}
      >
        {options.map((o) => {
          const val = typeof o === 'string' ? o : o.value;
          const lab = typeof o === 'string' ? o : o.label;
          return (
            <option key={val} value={val}>
              {lab}
            </option>
          );
        })}
      </select>
      <svg
        className="pointer-events-none absolute top-1/2 right-3 h-5 w-5 -translate-y-1/2 text-campaign"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        aria-hidden="true"
      >
        <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

// ── 小元件 ──────────────────────────────────────────────
function SectionTag({ no, label }: { no: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-7 w-7 items-center justify-center bg-campaign font-serif text-sm font-black text-paper">
        {no}
      </span>
      <h2 className="font-serif text-xl font-black tracking-wide text-ink">{label}</h2>
    </div>
  );
}

function Stamp({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex -rotate-6 items-center gap-1 border-[2.5px] border-campaign px-1.5 py-0.5 font-serif text-[11px] font-black tracking-widest text-campaign">
      {children}
    </span>
  );
}

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`border-[3px] border-ink bg-white p-5 shadow-[5px_5px_0_0_var(--color-ink)] ${className}`}>
      {children}
    </section>
  );
}

export default function App() {
  const [county, setCounty] = useState(DEFAULT.county);
  const [district, setDistrict] = useState(DEFAULT.district);
  const [code, setCode] = useState(DEFAULT.region_code);
  const [copied, setCopied] = useState(false);

  const districts = useMemo(
    () => [...new Set(villages.filter((x) => x.county === county).map((x) => x.district))],
    [county],
  );
  const districtVillages = useMemo(
    () => villages.filter((x) => x.county === county && x.district === district),
    [county, district],
  );
  const v = useMemo(
    () => districtVillages.find((x) => x.region_code === code) ?? districtVillages[0],
    [districtVillages, code],
  );

  function onCounty(c: string) {
    const d = villages.find((x) => x.county === c)!.district;
    setCounty(c);
    setDistrict(d);
    setCode(villages.find((x) => x.county === c && x.district === d)!.region_code);
  }
  function onDistrict(d: string) {
    setDistrict(d);
    setCode(villages.find((x) => x.county === county && x.district === d)!.region_code);
  }

  const deposit = depositThreshold(v);
  const win = winInsight(v);
  const comp = competition(v);
  const conf = CONFIDENCE[win.confidence];
  const tier = TIER[comp.tier];
  const histMax = win.histMaxWin ?? 1;

  // 分區趣味數據（目前所選區之最）
  const best = useMemo(() => {
    const rows = districtVillages.map((x) => ({ v: x, dep: depositThreshold(x).votes, c: competition(x) }));
    const minBy = <T,>(arr: T[], f: (t: T) => number) => arr.reduce((a, b) => (f(b) < f(a) ? b : a));
    const maxBy = <T,>(arr: T[], f: (t: T) => number) => arr.reduce((a, b) => (f(b) > f(a) ? b : a));
    const hist = rows.filter((r) => r.c.hasHistory);
    const aged = hist.filter((r) => r.c.incumbentAge);
    const safe = hist.length ? hist : rows;
    return {
      cheapDeposit: minBy(rows, (r) => r.dep),
      easyWin: minBy(safe, (r) => r.c.climbVotes),
      topChance: maxBy(safe, (r) => r.c.score),
      oldest: aged.length ? maxBy(aged, (r) => r.c.incumbentAge!) : safe[0],
    };
  }, [districtVillages]);

  const shareText = useMemo(
    () =>
      `${v.county}${v.district}${v.village}｜選里長要幾票？\n` +
      `🛟 保住 5,000 元保證金：至少 ${nf(deposit.votes)} 票\n` +
      (win.lastWinner ? `🏆 上屆當選 ${win.lastWinner.name} 拿 ${nf(win.lastWinner.votes)} 票\n` : '') +
      `🎯 參選機會：${tier.dot} ${comp.tier}（指數 ${comp.score}）\n` +
      `你家那個里要幾票？來算 👉`,
    [v, deposit.votes, win.lastWinner, comp.tier, comp.score, tier.dot],
  );

  function copy() {
    navigator.clipboard?.writeText(shareText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function share() {
    const data = { title: '里長票數計算機', text: shareText, url: typeof location !== 'undefined' ? location.href : '' };
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share(data);
        return;
      } catch {
        /* 使用者取消分享，忽略 */
      }
    }
    copy();
  }

  return (
    <div className="mx-auto min-h-screen max-w-xl px-4 pb-12">
      {/* 報頭 / Masthead */}
      <header className="mt-5 border-[3px] border-ink bg-ink text-paper">
        <div className="flex items-center justify-between border-b border-paper/30 px-4 py-1 text-[11px] font-medium tracking-widest text-gold-soft">
          <span>選 里 長 速 報 · Beta</span>
          <span>資料：中選會</span>
        </div>
        <div className="px-4 py-4 text-center">
          <h1 className="font-serif text-[34px] leading-none font-black tracking-tight">
            里長票數計算機
          </h1>
          <p className="mt-2 text-sm text-paper/80">想選里長？先看你那個里要拿幾票，才不會白忙一場。</p>
        </div>
      </header>

      {/* 三層選單：縣市 → 區 → 里 */}
      <div className="mt-5 space-y-2">
        <label className="block font-serif text-sm font-bold tracking-wide text-ink-soft">① 選你的里</label>
        <div className="grid grid-cols-2 gap-2">
          <Dropdown label="縣市" value={county} onChange={onCounty} options={COUNTIES} />
          <Dropdown label="鄉鎮市區" value={district} onChange={onDistrict} options={districts} />
        </div>
        <Dropdown
          label="村里"
          big
          value={v.region_code}
          onChange={setCode}
          options={districtVillages.map((x) => ({ value: x.region_code, label: x.village }))}
        />
      </div>

      <div className="mt-5 space-y-5">
        {/* ② 退保證金 — 主角卡 */}
        <Panel className="relative overflow-hidden bg-campaign-hero! text-paper">
          <BallotStamp className="pointer-events-none absolute -top-6 -right-6 h-40 w-40 text-paper/10" />
          <div className="relative flex items-center justify-between">
            <SectionTagInverse no="②" label="退回保證金門檻" />
            <span className="border border-paper/60 px-2 py-0.5 text-[11px] font-bold tracking-widest">
              最準 · 近官方
            </span>
          </div>
          <div className="relative mt-4 flex items-end gap-3">
            <span className="font-serif text-7xl leading-none font-black tabular-nums">{nf(deposit.votes)}</span>
            <span className="mb-1 font-serif text-2xl font-black">票</span>
          </div>
          <p className="mt-3 text-[15px] leading-relaxed text-paper/90">
            拿到這個票數，就能保住 <b>{nf(deposit.deposit)} 元</b>保證金不被沒收。
          </p>
          <p className="mt-2 border-t border-paper/30 pt-2 text-xs text-paper/70">
            《選罷法》門檻 = 選舉人數 × 10%。本里選舉人數 {nf(deposit.electorate)} 人（中選會最近一屆官方數）。
          </p>
        </Panel>

        {/* ③ 當選要幾票 — 真實歷史 + 過半線 */}
        <Panel className="relative overflow-hidden">
          <ElectionStamp className="pointer-events-none absolute -top-6 -right-6 h-40 w-40 text-campaign opacity-20" />
          <div className="relative">
          <div className="flex items-center justify-between">
            <SectionTag no="③" label="當選要幾票" />
            <span className={`px-2 py-0.5 text-[11px] font-bold tracking-wide ${conf.cls}`}>{conf.text}</span>
          </div>

          {/* 過半參考線 */}
          <div className="mt-4 flex items-baseline justify-between border-b-[3px] border-dashed border-gold pb-2">
            <span className="font-serif text-base font-bold text-ink-soft">過半參考線</span>
            <span className="font-serif text-3xl font-black tabular-nums text-ink">{nf(win.halfLine)} 票</span>
          </div>
          <p className="mt-1.5 text-xs text-ink-soft/80">兩人對決時、要贏的大致門檻（過半有效票）。</p>

          {/* 近三屆實際當選票 */}
          {win.historicalWins.length > 0 ? (
            <div className="mt-4">
              <p className="mb-2 font-serif text-sm font-bold text-ink">近三屆實際當選票</p>
              <div className="space-y-2">
                {win.historicalWins.map((h, idx) => {
                  const pt = party(h.party);
                  const barColor = h.party && h.party !== 'IND' ? pt.dot : 'var(--color-ink)';
                  return (
                    <div key={h.year} className="flex items-center gap-2">
                      <span className="w-9 shrink-0 font-serif text-sm font-bold text-ink-soft tabular-nums">{h.year}</span>
                      <div className="relative h-6 flex-1 bg-paper">
                        <div className="absolute inset-y-0 left-0" style={{ width: `${Math.max(8, (h.votes / histMax) * 100)}%`, background: barColor }} />
                        <span className="absolute inset-y-0 left-2 flex items-center text-xs font-bold text-paper tabular-nums">
                          {nf(h.votes)}
                        </span>
                      </div>
                      <span className="flex w-28 shrink-0 items-center justify-end gap-1 text-xs font-medium text-ink-soft">
                        {idx === 0 && <BallotStamp className="h-4 w-4 shrink-0 text-campaign" />}
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: barColor }} title={pt.label} />
                        <span className="truncate">{h.name}</span>
                        {h.uncontested && <span className="shrink-0 text-campaign">·同額</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
              {(() => {
                const ps = [...new Set(win.historicalWins.map((h) => h.party ?? 'IND'))];
                return ps.some((p) => p !== 'IND') ? (
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-paper-line pt-2">
                    {ps.map((p) => (
                      <span key={p} className="flex items-center gap-1 text-[11px] text-ink-soft">
                        <span className="h-2 w-2 rounded-full" style={{ background: p === 'IND' ? 'var(--color-ink)' : party(p).dot }} />
                        {party(p).label}
                      </span>
                    ))}
                  </div>
                ) : null;
              })()}
              {win.historicalWins.some((h) => h.uncontested) && (
                <p className="mt-2 text-[11px] leading-relaxed text-ink-soft/70">
                  ※「同額」＝該屆只有他 1 人登記、沒有對手，等於自動當選。
                </p>
              )}
            </div>
          ) : (
            <p className="mt-4 text-sm text-ink-soft/70">查無歷屆得票資料，無法顯示實際當選票。</p>
          )}

          <p className="mt-4 border-l-[3px] border-gold bg-paper px-3 py-2 text-[13px] leading-relaxed text-ink-soft">
            {win.candidateNote}
          </p>
          </div>
        </Panel>

        {/* ④ 參選機會 */}
        <Panel>
          <SectionTag no="④" label="你的參選機會" />

          {/* 機會指數 + 等級 */}
          <div className="mt-4 flex items-end justify-between">
            <div>
              <p className="text-xs font-bold text-ink-soft">參選機會指數</p>
              <p className="font-serif leading-none font-black tabular-nums text-ink">
                <span className="text-5xl">{comp.score}</span>
                <span className="ml-1 text-xl text-ink-soft/50">/ 100</span>
              </p>
            </div>
            <span className={`font-serif text-xl font-black px-3 py-1.5 ${tier.cls}`}>
              {tier.dot} {comp.tier}
            </span>
          </div>
          <p className="mt-2 text-sm font-medium text-ink-soft">{tier.sub}</p>

          {comp.hasHistory && (
            <>
              {/* 登頂要幾票 */}
              <div className="mt-4 flex items-baseline justify-between border-b-[3px] border-dashed border-gold pb-2">
                <span className="font-serif text-base font-bold text-ink-soft">登頂（當選）大約要</span>
                <span className="font-serif text-3xl font-black tabular-nums text-campaign">{nf(comp.climbVotes)} 票</span>
              </div>
              <p className="mt-1.5 text-xs text-ink-soft/80">{comp.climbBasis}。</p>

              {/* 連任 */}
              {comp.consecutiveTerms > 0 && (
                <div className="mt-4 flex items-center gap-1.5">
                  <span className="mr-1 text-xs font-bold text-ink-soft">現任連任</span>
                  {Array.from({ length: Math.min(comp.consecutiveTerms, 5) }).map((_, i) => (
                    <span
                      key={i}
                      className="flex h-6 w-6 items-center justify-center bg-ink font-serif text-[12px] font-black text-paper tabular-nums"
                    >
                      {i + 1}
                    </span>
                  ))}
                  <span className="ml-1 font-serif text-lg font-black text-campaign">連任 {comp.consecutiveTerms} 屆</span>
                </div>
              )}

              {/* 機會指數明細 */}
              {comp.factors.length > 0 && (
                <div className="mt-4">
                  <p className="mb-1.5 text-xs font-bold text-ink-soft">機會指數怎麼來的</p>
                  <div className="space-y-1">
                    {comp.factors.map((f, i) => (
                      <div key={i} className="flex items-center justify-between border-b border-paper-line py-1 text-[13px]">
                        <span className="text-ink-soft">{f.label}</span>
                        <span
                          className={`ml-2 shrink-0 font-serif font-black tabular-nums ${f.points > 0 ? 'text-emerald-600' : 'text-rose-500'}`}
                        >
                          {f.points > 0 ? `+${f.points}` : f.points}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          <p className="mt-4 border-l-[3px] border-gold bg-paper px-3 py-2 text-[14px] leading-relaxed text-ink">{comp.note}</p>

          {/* 評分標準（可點開） */}
          <details className="mt-3 border-t border-paper-line pt-2 text-ink-soft">
            <summary className="cursor-pointer text-xs font-bold select-none">參選機會指數怎麼評分？</summary>
            <div className="mt-2 space-y-1.5 text-[12px] leading-relaxed">
              <p>
                從 <b>50 分</b> 起算（滿分 100），依下列因素加減：
              </p>
              <ul className="ml-3 list-disc space-y-0.5">
                <li>上屆票數越接近 → 機會越大（最多 +30）</li>
                <li>現任票逐屆下滑 → 新人空間擴大</li>
                <li>投票率低、還有票沒被動員 → 加分</li>
                <li>長期同額、沒人卡位 → +20</li>
                <li>現任資深、可能交棒 → 加分</li>
                <li>已有強棒參選人卡位 → 機會打折（最多 −35）</li>
              </ul>
              <p className="pt-1 font-medium">🟢 大好機會 70↑ ／ 🟡 有機會 50–69 ／ 🟠 拚拚看 30–49 ／ 🔴 硬仗 30↓</p>
              <p className="text-ink-soft/60">＊估算僅供參考，真實選情仍看當年參選人數與動員。</p>
            </div>
          </details>
        </Panel>

        {/* 分區趣味數據：大雅區之最 */}
        <section className="border-[3px] border-ink bg-white p-5 shadow-[5px_5px_0_0_var(--color-ink)]">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center bg-gold font-serif text-sm font-black text-ink">★</span>
            <h2 className="font-serif text-xl font-black text-ink">{district}之最</h2>
          </div>
          <p className="mt-1 text-xs text-ink-soft/70">同區跨里 PK，點一下跳到那個里</p>
          <div className="mt-3 divide-y divide-paper-line">
            {[
              { emoji: '🛟', label: '保證金最好退', r: best.cheapDeposit, val: `只要 ${nf(best.cheapDeposit.dep)} 票` },
              { emoji: '🏆', label: '當選門檻最低', r: best.easyWin, val: `約 ${nf(best.easyWin.c.climbVotes)} 票就上` },
              { emoji: '🟢', label: '參選機會最大', r: best.topChance, val: `機會指數 ${best.topChance.c.score}` },
              {
                emoji: '🎖️',
                label: '最資深現任',
                r: best.oldest,
                val: best.oldest.c.incumbentAge
                  ? `${best.oldest.c.incumbentName}・約 ${best.oldest.c.incumbentAge} 歲`
                  : (best.oldest.c.incumbentName ?? ''),
              },
            ].map((row) => (
              <button
                key={row.label}
                onClick={() => setCode(row.r.v.region_code)}
                className="flex w-full cursor-pointer items-center justify-between gap-2 py-2.5 text-left transition-colors hover:bg-paper"
              >
                <span className="flex items-center gap-2 text-sm font-medium text-ink-soft">
                  <span>{row.emoji}</span>
                  {row.label}
                </span>
                <span className="text-right text-sm">
                  <b className="font-serif text-ink">{row.r.v.village}</b>{' '}
                  <span className="text-ink-soft/70">{row.val}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* 分享 */}
        <section className="border-[3px] border-ink bg-ink p-5 text-paper">
          <p className="mb-3 font-serif text-sm font-bold tracking-wide text-gold-soft">把你家的戰況傳給朋友</p>
          <p className="mb-4 border-l-2 border-paper/30 pl-3 text-sm leading-relaxed whitespace-pre-line text-paper/85">
            {shareText}
          </p>
          <div className="flex gap-3">
            <button
              onClick={share}
              className="flex-1 cursor-pointer border-[3px] border-paper bg-campaign py-3 font-serif text-base font-black tracking-widest text-paper transition-colors duration-200 hover:bg-campaign-dark focus:ring-2 focus:ring-gold-soft focus:outline-none"
            >
              一鍵分享
            </button>
            <button
              onClick={copy}
              className="flex-1 cursor-pointer border-[3px] border-paper/60 py-3 font-serif text-base font-black tracking-widest text-paper transition-colors duration-200 hover:border-paper focus:ring-2 focus:ring-gold-soft focus:outline-none"
            >
              {copied ? '✓ 已複製' : '複製文字'}
            </button>
          </div>
        </section>

        {/* 免責 */}
        <footer className="space-y-1 px-1 text-center text-[11px] leading-relaxed text-ink-soft/70">
          <p>資料來源：{meta.election_source}。{meta.scope}。</p>
          <p>退保證金門檻依官方選舉人數試算；參選機會與當選票數為估算，僅供參考，不構成任何當選保證。</p>
        </footer>
      </div>
    </div>
  );
}

// 深色卡片用的反白標題
function SectionTagInverse({ no, label }: { no: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-7 w-7 items-center justify-center bg-paper font-serif text-sm font-black text-campaign">
        {no}
      </span>
      <h2 className="font-serif text-xl font-black tracking-wide text-paper">{label}</h2>
    </div>
  );
}
