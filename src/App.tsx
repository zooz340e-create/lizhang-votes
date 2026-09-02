import { useEffect, useMemo, useState } from 'react';
import {
  depositThreshold,
  winInsight,
  competition,
  commitmentFunnel,
  DEFAULT_FUNNEL_TIERS,
  type OppTier,
  type CommitmentTier,
} from './lib/calc';
import { shareCard } from './lib/shareCard';
import PollCard, { SIGNUP_FORM } from './PollCard';
import { loadIndex, loadCounty, loadDemo, villageDemo, type VillageRow, type DataIndex, type DemoFile } from './lib/data';

const nf = (n: number) => n.toLocaleString('zh-TW');

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
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Opt[];
  big?: boolean;
  label: string;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full cursor-pointer appearance-none border-[3px] border-ink bg-white pr-10 pl-4 font-serif font-black ${value ? 'text-ink' : 'text-ink-soft/60'} focus:border-campaign focus:outline-none ${big ? 'py-3.5 text-xl' : 'py-3 text-base'}`}
      >
        {placeholder && <option value="">{placeholder}</option>}
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

// 承諾階梯漏斗的人數輸入框
function TierInput({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-[13px] leading-snug text-ink-soft">{label}</span>
      <input
        type="number"
        min={0}
        inputMode="numeric"
        value={value || ''}
        placeholder="0"
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        className="w-24 shrink-0 border-[3px] border-ink bg-white px-2 py-1 text-right font-serif text-base font-black tabular-nums text-ink focus:border-campaign focus:outline-none"
      />
    </label>
  );
}

function Guide({ county, district }: { county: string; district: string }) {
  const step = !county ? '① 選擇縣市' : !district ? '② 選擇鄉鎮市區' : '③ 選擇村里';
  return (
    <div className="mt-6 border-[3px] border-dashed border-ink/30 p-8 text-center">
      <div className="text-4xl">🗳️</div>
      <p className="mt-3 font-serif text-lg font-black text-ink">跟著上面三步，選出你的里</p>
      <p className="mt-1.5 text-sm text-ink-soft">
        下一步：<b className="text-campaign">{step}</b>
      </p>
      <p className="mt-1 text-xs text-ink-soft/70">選好村里，就會跑出退保證金門檻、當選票數、參選機會。</p>
    </div>
  );
}

export default function App() {
  const [index, setIndex] = useState<DataIndex>();
  const [county, setCounty] = useState(''); // 縣市代碼（例：臺中市 66000）
  const [rows, setRows] = useState<VillageRow[]>([]); // 所選縣市的全部里
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [district, setDistrict] = useState('');
  const [code, setCode] = useState('');
  const [demo, setDemo] = useState<DemoFile | null>(null);
  const [tierCounts, setTierCounts] = useState<number[]>(() => DEFAULT_FUNNEL_TIERS.map(() => 0));
  const [cardBusy, setCardBusy] = useState(false);

  // 首屏只載縣市清單（約 2KB）
  useEffect(() => {
    loadIndex()
      .then(setIndex)
      .catch(() => setError('縣市清單載入失敗，請重新整理頁面'));
  }, []);

  // 選了縣市才載該縣市資料（有快取，切回來不重抓）
  useEffect(() => {
    if (!county) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    loadCounty(county)
      .then((vs) => {
        if (!cancelled) setRows(vs);
      })
      .catch(() => {
        if (!cancelled) setError('資料載入失敗，請檢查網路後再選一次');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [county]);

  // 里況資料（試營運縣市才有檔案，無檔自動缺席）
  useEffect(() => {
    if (!county) { setDemo(null); return; }
    let cancelled = false;
    loadDemo(county).then((d) => { if (!cancelled) setDemo(d); });
    return () => { cancelled = true; };
  }, [county]);

  const meta = index?.meta;
  const districts = useMemo(() => [...new Set(rows.map((x) => x.district))], [rows]);
  const districtVillages = useMemo(
    () => (district ? rows.filter((x) => x.district === district) : []),
    [rows, district],
  );
  const v = useMemo(() => (code ? rows.find((x) => x.region_code === code) : undefined), [rows, code]);

  function onCounty(c: string) {
    setCounty(c);
    setDistrict('');
    setCode('');
  }
  function onDistrict(d: string) {
    setDistrict(d);
    setCode('');
  }

  // 分區之最（目前所選區；未選區時為 null）
  const best = useMemo(() => {
    if (!districtVillages.length) return null;
    const rows = districtVillages.map((x) => ({ v: x, dep: depositThreshold(x).votes, c: competition(x) }));
    const minBy = <T,>(arr: T[], f: (t: T) => number) => arr.reduce((a, b) => (f(b) < f(a) ? b : a));
    const maxBy = <T,>(arr: T[], f: (t: T) => number) => arr.reduce((a, b) => (f(b) > f(a) ? b : a));
    const hist = rows.filter((r) => r.c.hasHistory);
    const safe = hist.length ? hist : rows;
    const aged = hist.filter((r) => r.c.incumbentAge);
    return {
      cheapDeposit: minBy(rows, (r) => r.dep),
      easyWin: minBy(safe, (r) => r.c.climbVotes),
      topChance: maxBy(safe, (r) => r.c.score),
      oldest: aged.length ? maxBy(aged, (r) => r.c.incumbentAge!) : safe[0],
    };
  }, [districtVillages]);

  const funnelTiers: CommitmentTier[] = useMemo(
    () => DEFAULT_FUNNEL_TIERS.map((t, i) => ({ ...t, count: tierCounts[i] ?? 0 })),
    [tierCounts],
  );
  const funnel = useMemo(() => commitmentFunnel(funnelTiers), [funnelTiers]);

  const shareText = useMemo(() => {
    if (!v) return '';
    const de = villageDemo(demo, v.district, v.village);
    const d = depositThreshold(v, de?.a20, de?.y);
    const w = winInsight(v);
    const c = competition(v);
    return (
      `${v.county}${v.district}${v.village}｜選里長要幾票？\n` +
      `🛟 保住 ${nf(d.deposit)} 元保證金：至少 ${nf(d.votes)} 票\n` +
      (w.lastWinner ? `🏆 上屆當選 ${w.lastWinner.name} 拿 ${nf(w.lastWinner.votes)} 票\n` : '') +
      `🎯 參選機會：${TIER[c.tier].dot} ${c.tier}（指數 ${c.score}）\n` +
      `你家那個里要幾票？來算 👉`
    );
  }, [v, demo]);

  return (
    <div className="mx-auto min-h-screen max-w-xl px-4 pb-12">
      {/* 報頭 / Masthead */}
      <header className="mt-5 border-[3px] border-ink bg-ink text-paper">
        <div className="flex items-center justify-between border-b border-paper/30 px-4 py-1 text-[11px] font-medium tracking-widest text-gold-soft">
          <span>選 里 長 速 報 · Beta</span>
          <a href="plan.html" className="underline decoration-dotted underline-offset-2 hover:text-paper">
            🗺️ 選戰行程 →
          </a>
        </div>
        <div className="px-4 py-4 text-center">
          <h1 className="font-serif text-[34px] leading-none font-black tracking-tight">
            里長票數計算機
          </h1>
          <p className="mt-2 text-sm text-paper/80">想選里長？先看你那個里要拿幾票，才不會白忙一場。</p>
        </div>
      </header>

      {/* 引導式三層選單：縣市 → 區 → 里（逐步出現）*/}
      <div className="mt-5 space-y-2">
        <label className="block font-serif text-sm font-bold tracking-wide text-ink-soft">跟著選你的里 👇</label>
        <Dropdown
          label="縣市"
          placeholder={index ? '① 選擇縣市' : '縣市清單載入中…'}
          value={county}
          onChange={onCounty}
          options={index?.counties.map((c) => ({ value: c.code, label: c.name })) ?? []}
        />
        {error && (
          <p className="border-[3px] border-campaign bg-campaign/5 px-3 py-2 text-sm font-bold text-campaign">
            ⚠ {error}
          </p>
        )}
        {county && loading && (
          <p className="px-1 py-2 text-sm font-medium text-ink-soft">📦 正在載入這個縣市的資料…</p>
        )}
        {county && !loading && rows.length > 0 && (
          <Dropdown label="鄉鎮市區" placeholder="② 選擇鄉鎮市區" value={district} onChange={onDistrict} options={districts} />
        )}
        {county && district && (
          <Dropdown
            label="村里"
            big
            placeholder="③ 選擇村里"
            value={code}
            onChange={setCode}
            options={districtVillages.map((x) => ({ value: x.region_code, label: x.village }))}
          />
        )}
      </div>

      {!v && <Guide county={county} district={district} />}

      {v &&
        (() => {
          const dEntry = villageDemo(demo, v.district, v.village);
          const deposit = depositThreshold(v, dEntry?.a20, dEntry?.y);
          const win = winInsight(v);
          const comp = competition(v);
          const tier = TIER[comp.tier];
          const histMax = win.histMaxWin ?? 1;
          // 距投票日與每日配額（115-11-28 投票）
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const daysLeft = Math.max(1, Math.ceil((new Date('2026-11-28T00:00:00').getTime() - today.getTime()) / 86_400_000));
          const dailyDeposit = Math.ceil(deposit.votes / daysLeft);
          const dailyWin = comp.hasHistory ? Math.ceil(comp.climbVotes / daysLeft) : 0;
          return (
            <div className="mt-5 space-y-5">
        {/* 行政區調整新里標示 */}
        {v.adj && (
          <p className="border-[3px] border-gold bg-gold/10 px-3 py-2 text-[13px] leading-relaxed font-bold text-ink">
            🆕 {v.adj}
          </p>
        )}
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
            《選罷法》門檻 = 選舉人數 × 10%。
            {deposit.basis === 'adult20' ? (
              <>
                計算基礎：本里 20 歲以上人口 <b className="tabular-nums">{nf(deposit.electorate)}</b> 人
                （內政部民國 {deposit.basisYear} 年 12 月戶籍統計）。
                {deposit.lastElectorate !== undefined && deposit.driftPct !== undefined && (
                  <>
                    對照上屆（2022）官方選舉人數 {nf(deposit.lastElectorate)} 人，
                    {deposit.driftPct >= 0 ? `成長 ${deposit.driftPct}%` : `減少 ${Math.abs(deposit.driftPct)}%`}。
                  </>
                )}
              </>
            ) : deposit.basis === 'popEstimate' ? (
              <>
                本里因行政區調整，上屆選舉人數已不適用；此處以最新戶籍人口推估
                <b className="tabular-nums">{nf(deposit.electorate)}</b> 人。
              </>
            ) : (
              <>本里選舉人數 {nf(deposit.electorate)} 人（上一屆官方數；此里暫無最新人口統計）。</>
            )}
            正式門檻以投票日選委會公告之選舉人數為準。
          </p>
          <div className="mt-3 flex gap-3">
            <div className="flex-1 border-2 border-paper/50 p-2 text-center">
              <p className="text-[11px] font-bold text-paper/70">⏳ 距 11/28 投票日</p>
              <p className="font-serif text-4xl leading-tight font-black tabular-nums">
                {daysLeft}<span className="ml-1 text-lg">天</span>
              </p>
            </div>
            <div className="flex-1 border-2 border-gold-soft bg-paper/10 p-2 text-center">
              <p className="text-[11px] font-bold text-paper/70">每天累積支持者</p>
              <p className="font-serif text-4xl leading-tight font-black text-gold-soft tabular-nums">
                +{nf(dailyDeposit)}<span className="ml-1 text-lg">人</span>
              </p>
            </div>
          </div>
          <p className="mt-1.5 text-center text-[11px] text-paper/60">照這個節奏走，投票日就跨過保證金線。</p>
        </Panel>

        {/* ③ 當選要幾票 — 真實歷史 + 過半線 */}
        <Panel className="relative overflow-hidden">
          <ElectionStamp className="pointer-events-none absolute -top-6 -right-6 h-40 w-40 text-campaign opacity-20" />
          <div className="relative">
          <SectionTag no="③" label="當選要幾票" />
          {win.confidence !== 'high' && (
            <p className="mt-1.5 inline-block bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
              ⚠ 此里僅 {v.history?.length ?? 0} 屆資料，參考用
            </p>
          )}

          {/* 過半參考線 */}
          <div className="mt-4 flex items-baseline justify-between border-b-[3px] border-dashed border-gold pb-2">
            <span className="font-serif text-base font-bold text-ink-soft">過半參考線</span>
            <span className="font-serif text-3xl font-black tabular-nums text-ink">{nf(win.halfLine)} 票</span>
          </div>
          <p className="mt-1.5 text-xs text-ink-soft/80">兩人對決時、要贏的大致門檻（過半有效票）。</p>
          {v.history?.[0] && (
            <p className="mt-1 text-xs text-ink-soft tabular-nums">
              上屆投票率 <b>{Math.round(win.turnout * 1000) / 10}%</b>
              {v.history[0].valid_votes !== undefined && <>・有效票 <b>{nf(v.history[0].valid_votes)}</b> 張</>}
            </p>
          )}

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
                          {h.sharePct !== undefined && !h.uncontested && (
                            <span className="ml-1 opacity-80">（{h.sharePct}%）</span>
                          )}
                        </span>
                      </div>
                      <span className="flex w-28 shrink-0 items-center justify-end gap-1 text-xs font-medium text-ink-soft">
                        {idx === 0 && <BallotStamp className="h-4 w-4 shrink-0 text-campaign" />}
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: barColor }} title={pt.label} />
                        <span className="truncate">{h.name}</span>
                        {h.uncontested && <span className="shrink-0 text-campaign">·同額</span>}
                        {h.tie && <span className="shrink-0 text-campaign">·抽籤</span>}
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
              <div className="mt-2 flex gap-3">
                <div className="flex-1 border-[3px] border-ink bg-paper p-2 text-center">
                  <p className="text-[11px] font-bold text-ink-soft">⏳ 距投票日</p>
                  <p className="font-serif text-3xl leading-tight font-black text-ink tabular-nums">
                    {daysLeft}<span className="ml-1 text-base">天</span>
                  </p>
                </div>
                <div className="flex-1 border-[3px] border-campaign bg-campaign/5 p-2 text-center">
                  <p className="text-[11px] font-bold text-ink-soft">登頂每天要累積</p>
                  <p className="font-serif text-3xl leading-tight font-black text-campaign tabular-nums">
                    +{nf(dailyWin)}<span className="ml-1 text-base">人</span>
                  </p>
                </div>
              </div>

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

        {/* 里況速覽：TESAS 年齡結構（試營運縣市才有） */}
        {(() => {
          const d = villageDemo(demo, v.district, v.village);
          if (!d) return null;
          const seg = [
            { label: '幼年 0–14', cnt: d.young, per: d.young_p, color: 'var(--color-gold)' },
            { label: '青壯 15–64', cnt: d.work, per: d.work_p, color: 'var(--color-ink)' },
            { label: '高齡 65+', cnt: d.old, per: d.old_p, color: 'var(--color-campaign)' },
          ];
          return (
            <Panel>
              <div className="flex items-center justify-between">
                <SectionTag no="⑤" label="這個里的長相" />
                <span className="bg-paper px-2 py-0.5 text-[11px] font-bold text-ink-soft">全臺 · 民國 {d.y} 年</span>
              </div>
              <div className="mt-4 flex h-7 w-full overflow-hidden">
                {seg.map((s) => (
                  <div key={s.label} className="h-full" style={{ width: `${s.per}%`, background: s.color }} title={`${s.label} ${s.per}%`} />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {seg.map((s) => (
                  <span key={s.label} className="flex items-center gap-1.5 text-xs text-ink-soft">
                    <span className="h-2.5 w-2.5 shrink-0" style={{ background: s.color }} />
                    {s.label}：<b className="font-serif text-ink tabular-nums">{s.per}%</b>（{nf(s.cnt)} 人）
                  </span>
                ))}
              </div>
              {d.ta_p !== undefined && (
                <div className="mt-3 flex gap-3">
                  <div className="flex-1 border-[3px] border-ink bg-paper p-2 text-center">
                    <p className="text-[11px] font-bold text-ink-soft">30–49 歲（青壯主力）</p>
                    <p className="font-serif text-xl font-black text-ink tabular-nums">{d.ta_p}%</p>
                    <p className="text-[11px] text-ink-soft tabular-nums">{nf(d.ta ?? 0)} 人</p>
                  </div>
                  <div className="flex-1 border-[3px] border-ink bg-paper p-2 text-center">
                    <p className="text-[11px] font-bold text-ink-soft">60 歲以上</p>
                    <p className="font-serif text-xl font-black text-campaign tabular-nums">{d.o60_p}%</p>
                    <p className="text-[11px] text-ink-soft tabular-nums">{nf(d.o60 ?? 0)} 人</p>
                  </div>
                </div>
              )}
              <p className="mt-3 border-l-[3px] border-gold bg-paper px-3 py-2 text-[13px] leading-relaxed text-ink-soft">
                老化指數 <b className="font-serif text-ink tabular-nums">{d.aging}</b>
                {d.aging >= 200 ? '——每 1 位小孩對上 2 位以上長輩，長照與共餐是這裡的硬需求。' :
                 d.aging >= 100 ? '——長輩已多於小孩，高齡議題正在變成日常。' :
                 '——小孩還比長輩多，是相對年輕的社區。'}
              </p>
              <p className="mt-2 text-[11px] text-ink-soft/60">
                資料：{demo?.meta.source}（民國 {d.y} 年，僅供趨勢參考）
              </p>
            </Panel>
          );
        })()}

        {/* ⑥ 陸戰漏斗：支持度試算（誠實區間，非單一預測） */}
        <Panel>
          <div className="flex items-center justify-between">
            <SectionTag no="⑥" label="陸戰漏斗：支持度試算" />
            <span className="bg-paper px-2 py-0.5 text-[11px] font-bold text-ink-soft">試營運</span>
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
            填入你各階段接觸到的人數，抓出「保守 ~ 樂觀」的估票區間——不是精準預測，是幫你分配陸戰資源的參考。
          </p>

          <div className="mt-3 divide-y divide-paper-line">
            {DEFAULT_FUNNEL_TIERS.map((t, i) => (
              <TierInput key={t.key} label={t.label} value={tierCounts[i] ?? 0} onChange={(n) => setTierCounts((prev) => prev.map((x, j) => (j === i ? n : x)))} />
            ))}
          </div>

          <div className="mt-4 flex items-baseline justify-between border-t-[3px] border-dashed border-gold pt-3">
            <span className="font-serif text-base font-bold text-ink-soft">估票區間</span>
            <span className="font-serif text-3xl font-black tabular-nums text-campaign">
              {nf(funnel.low)} ~ {nf(funnel.high)} 票
            </span>
          </div>
          {funnel.totalContacts > 0 && v && (
            <p className="mt-1.5 text-xs text-ink-soft/80">
              合計接觸 {nf(funnel.totalContacts)} 人次。對照：過半參考線 {nf(win.halfLine)} 票、退保證金門檻 {nf(deposit.votes)} 票。
            </p>
          )}

          <details className="mt-3 border-t border-paper-line pt-2 text-ink-soft">
            <summary className="cursor-pointer text-xs font-bold select-none">這個區間怎麼來的？</summary>
            <div className="mt-2 space-y-1.5 text-[12px] leading-relaxed">
              <p>每一階的轉換率是「建議區間」，不是本里實測數據——來源是群眾募資領域「輕度承諾 → 重度承諾」轉換率隨投入程度遞增的通則，跨領域借用僅供起始參考。</p>
              <p>強烈建議你實際追蹤自己的加群數、連署數、志工報名數，用真實比例覆蓋這裡的預設值，數字才會越用越準。</p>
              <p className="text-ink-soft/60">＊本工具不做「會不會選上」的二元判定，只提供估票區間，實際選情仍看當年參選人數與動員。</p>
            </div>
          </details>
        </Panel>

        {/* ☀ 陽光民調（議題民調，免登入一鍵表態） */}
        <PollCard regionCode={v.region_code} />

        {/* 分區趣味數據：目前所選區之最 */}
        {best && (
        <section className="border-[3px] border-ink bg-white p-5 shadow-[5px_5px_0_0_var(--color-ink)]">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center bg-gold font-serif text-sm font-black text-ink">★</span>
            <h2 className="font-serif text-xl font-black text-ink">{v.district}之最</h2>
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
        )}

        {/* 分享 */}
        <section className="border-[3px] border-ink bg-ink p-5 text-paper">
          <p className="mb-3 font-serif text-sm font-bold tracking-wide text-gold-soft">把你家的戰況傳給朋友</p>
          <p className="mb-4 border-l-2 border-paper/30 pl-3 text-sm leading-relaxed whitespace-pre-line text-paper/85">
            {shareText}
          </p>
          <button
            onClick={async () => {
              setCardBusy(true);
              try {
                await shareCard(v, comp.consecutiveTerms, villageDemo(demo, v.district, v.village), 2026);
              } finally {
                setCardBusy(false);
              }
            }}
            disabled={cardBusy}
            className="block w-full cursor-pointer border-[3px] border-gold-soft bg-gold py-3 font-serif text-base font-black tracking-widest text-ink transition-colors duration-200 hover:bg-gold-soft disabled:opacity-50 focus:ring-2 focus:ring-paper focus:outline-none"
          >
            {cardBusy ? '產生中…' : '📇 下載選情圖卡（IG/FB 直式）'}
          </button>
        </section>

        {/* ⚔️ 數位競選總部報名入口 */}
        <a
          href={SIGNUP_FORM}
          target="_blank"
          rel="noreferrer"
          className="block border-[3px] border-ink bg-paper p-4 text-center shadow-[5px_5px_0_0_var(--color-ink)] transition-transform hover:-translate-y-0.5"
        >
          <p className="font-serif text-lg font-black text-ink">⚔️ 看完數字，想自己下場？</p>
          <p className="mt-1 text-[13px] text-ink-soft">缺空戰資源的參選者，這裡報名「數位競選總部」——願意公開金流，就是我們要找的人。</p>
        </a>

        {/* 免責 */}
        <footer className="space-y-1 px-1 text-center text-[11px] leading-relaxed text-ink-soft/70">
          <p>資料來源：{meta?.election_source ?? '中央選舉委員會'}。{meta?.scope ?? ''}。</p>
          <p>退保證金門檻依官方選舉人數試算；參選機會與當選票數為估算，僅供參考，不構成任何當選保證。</p>
        </footer>
            </div>
          );
        })()}
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
