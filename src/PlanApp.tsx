import { useEffect, useMemo, useState } from 'react';
import { commitmentFunnel, DEFAULT_FUNNEL_TIERS, type CommitmentTier } from './lib/calc';
import { STOP_TYPES, weekSkeleton, observedLineRate, type Stop, type StopType } from './lib/plan';

// 選戰行程規劃（教練版工具）— 像排旅遊行程一樣排陸戰
//
// 設計原則：
//  - 好感度掛「地點/場次」不掛「住戶」：逐戶記錄政治傾向屬個資法第 6 條特種個資，
//    本工具只記候選人自己的行動與匿名統計（發幾份文宣、幾人加 LINE），熱區以鄰/地點聚合。
//  - 資料只存瀏覽器 localStorage，不上傳任何伺服器（2026 免後端鐵律，也是個資最低風險）。
//  - 行程實測數字（加LINE/連署/志工）自動累計進承諾階梯漏斗 → 估票區間，
//    對照候選人自填的目標票數，回推每日還要接觸多少人。

const nf = (n: number) => n.toLocaleString('zh-TW');

export const VOTE_DAY = '2026-11-28'; // 投票日
export const REG_DEADLINE = '2026-09-10'; // 候選人登記截止

interface PlanState {
  targetVotes: number;
  stops: Stop[];
}

const STORAGE_KEY = 'cov-plan-v1';

function loadState(): PlanState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as PlanState;
      if (Array.isArray(p.stops)) {
        // 雙態欄位遷移：舊資料（無 done/planned）一律視為已執行的實績
        const stops = p.stops.map((s) => ({ ...s, planned: s.planned ?? 0, done: s.done ?? true }));
        return { targetVotes: p.targetVotes || 0, stops };
      }
    }
  } catch {
    /* 壞資料當作全新開始 */
  }
  return { targetVotes: 0, stops: [] };
}

function daysUntil(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((new Date(`${iso}T00:00:00`).getTime() - today.getTime()) / 86_400_000);
}

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];
function dateLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAY[d.getDay()]}）`;
}

const emptyDraft = (): Omit<Stop, 'id'> => ({
  date: new Date().toISOString().slice(0, 10),
  start: '',
  type: '站路口',
  place: '',
  hood: '',
  planned: 0,
  contacts: 0,
  line: 0,
  pledges: 0,
  volunteers: 0,
  cost: 0,
  rating: 0,
  note: '',
  done: true, // 預設「記實績」；排未來計畫時取消勾選即可
});

// ── 小元件（沿用計算機的紙感視覺）─────────────────────────
function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`border-[3px] border-ink bg-white p-5 shadow-[5px_5px_0_0_var(--color-ink)] ${className}`}>
      {children}
    </section>
  );
}

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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-bold text-ink-soft">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  'w-full border-[3px] border-ink bg-white px-2 py-1.5 text-[15px] font-medium text-ink focus:border-campaign focus:outline-none';

function NumInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <input
      type="number"
      min={0}
      inputMode="numeric"
      value={value || ''}
      placeholder="0"
      onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
      className={`${inputCls} text-right font-serif font-black tabular-nums`}
    />
  );
}

function Stars({ value, onChange }: { value: number; onChange?: (n: number) => void }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) =>
        onChange ? (
          <button
            key={i}
            type="button"
            onClick={() => onChange(i === value ? 0 : i)}
            className={`cursor-pointer text-xl leading-none ${i <= value ? 'text-gold' : 'text-paper-line'}`}
            aria-label={`好感度 ${i} 星`}
          >
            ★
          </button>
        ) : (
          <span key={i} className={`text-sm leading-none ${i <= value ? 'text-gold' : 'text-paper-line'}`}>
            ★
          </span>
        ),
      )}
    </span>
  );
}

// ── 主頁面 ──────────────────────────────────────────────
export default function PlanApp() {
  const [state, setState] = useState<PlanState>(loadState);
  const [draft, setDraft] = useState<Omit<Stop, 'id'>>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const daysToVote = daysUntil(VOTE_DAY);
  const daysToReg = daysUntil(REG_DEADLINE);

  // 依日期分組（新→舊排在下面：旅遊行程習慣由 Day1 往下）
  const byDate = useMemo(() => {
    const m = new Map<string, Stop[]>();
    for (const s of [...state.stops].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))) {
      const arr = m.get(s.date) ?? [];
      arr.push(s);
      m.set(s.date, arr);
    }
    return [...m.entries()];
  }, [state.stops]);

  // 累計數字 → 承諾階梯漏斗。只吃實績（done），計畫數字永不混入估票
  const totals = useMemo(() => {
    let contacts = 0, line = 0, pledges = 0, volunteers = 0, cost = 0;
    for (const s of state.stops) {
      if (!s.done) continue;
      contacts += s.contacts;
      line += s.line;
      pledges += s.pledges;
      volunteers += s.volunteers;
      cost += s.cost;
    }
    const counts = [contacts, line, pledges, volunteers];
    const tiers: CommitmentTier[] = DEFAULT_FUNNEL_TIERS.map((t, i) => ({ ...t, count: counts[i] ?? 0 }));
    return { contacts, line, pledges, volunteers, cost, funnel: commitmentFunnel(tiers) };
  }, [state.stops]);

  // 缺口與每日配額（以輕承諾中位轉換率 15% 回推，演算法公開）
  const gap = Math.max(0, state.targetVotes - Math.round((totals.funnel.low + totals.funnel.high) / 2));
  const dailyLine = daysToVote > 0 ? Math.ceil(gap / daysToVote / 0.15) : 0;

  // 熱區排行：以鄰/地點聚合（不落到戶），只看實績
  const hotspots = useMemo(() => {
    const m = new Map<string, { contacts: number; line: number; ratingSum: number; rated: number; visits: number }>();
    for (const s of state.stops.filter((x) => x.done)) {
      const key = s.hood || s.place;
      if (!key) continue;
      const h = m.get(key) ?? { contacts: 0, line: 0, ratingSum: 0, rated: 0, visits: 0 };
      h.contacts += s.contacts;
      h.line += s.line;
      h.visits += 1;
      if (s.rating > 0) {
        h.ratingSum += s.rating;
        h.rated += 1;
      }
      m.set(key, h);
    }
    return [...m.entries()]
      .map(([key, h]) => ({ key, ...h, avgRating: h.rated ? h.ratingSum / h.rated : 0 }))
      .sort((a, b) => b.avgRating - a.avgRating || b.line - a.line)
      .slice(0, 5);
  }, [state.stops]);

  function saveDraft() {
    if (!draft.place.trim()) return;
    if (editingId) {
      setState((p) => ({ ...p, stops: p.stops.map((s) => (s.id === editingId ? { ...draft, id: editingId } : s)) }));
    } else {
      setState((p) => ({ ...p, stops: [...p.stops, { ...draft, id: crypto.randomUUID() }] }));
    }
    setDraft(emptyDraft());
    setEditingId(null);
    setFormOpen(false);
  }

  function edit(s: Stop) {
    const { id, ...rest } = s;
    setDraft(rest);
    setEditingId(id);
    setFormOpen(true);
  }

  function remove(id: string) {
    setState((p) => ({ ...p, stops: p.stops.filter((s) => s.id !== id) }));
    if (editingId === id) {
      setEditingId(null);
      setDraft(emptyDraft());
    }
  }

  // 打卡：把計畫中的行程載入表單，切成「記實績」模式
  function checkIn(s: Stop) {
    const { id, ...rest } = s;
    setDraft({ ...rest, done: true, contacts: rest.contacts || rest.planned });
    setEditingId(id);
    setFormOpen(true);
  }

  // 一鍵生成未來 7 天行程草稿（已有行程的日子整天跳過）
  function generateWeek() {
    const skeleton = weekSkeleton({
      fromISO: new Date().toISOString().slice(0, 10),
      days: 7,
      existingDates: state.stops.map((s) => s.date),
      dailyLineQuota: dailyLine,
      lineRate: observedLineRate(totals.contacts, totals.line),
    });
    if (skeleton.length === 0) return;
    setState((p) => ({ ...p, stops: [...p.stops, ...skeleton.map((s) => ({ ...s, id: crypto.randomUUID() }))] }));
  }

  return (
    <div className="mx-auto min-h-screen max-w-xl px-4 pb-12">
      {/* 報頭 */}
      <header className="mt-5 border-[3px] border-ink bg-ink text-paper">
        <div className="flex items-center justify-between border-b border-paper/30 px-4 py-1 text-[11px] font-medium tracking-widest text-gold-soft">
          <span>選 戰 行 程 · 教練版</span>
          <a href="./" className="underline decoration-dotted underline-offset-2 hover:text-paper">
            ← 回票數計算機
          </a>
        </div>
        <div className="px-4 py-4 text-center">
          <h1 className="font-serif text-[30px] leading-none font-black tracking-tight">選戰行程規劃</h1>
          <p className="mt-2 text-sm text-paper/80">把選戰當一趟旅程來排：今天去哪站、見了幾個人、花了多少錢。</p>
        </div>
        <div className="flex divide-x divide-paper/30 border-t border-paper/30 text-center">
          <div className="flex-1 py-2">
            <p className="text-[11px] text-paper/70">距投票日 11/28</p>
            <p className="font-serif text-xl font-black text-gold-soft tabular-nums">{daysToVote} 天</p>
          </div>
          <div className="flex-1 py-2">
            <p className="text-[11px] text-paper/70">距登記截止 9/10</p>
            <p className="font-serif text-xl font-black tabular-nums">{daysToReg > 0 ? `${daysToReg} 天` : '已截止'}</p>
          </div>
        </div>
      </header>

      <div className="mt-5 space-y-5">
        {/* ① 目標與進度 */}
        <Panel>
          <SectionTag no="①" label="目標與進度" />
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-[13px] text-ink-soft">目標票數（先用計算機查你的門檻）</span>
            <div className="w-28">
              <NumInput value={state.targetVotes} onChange={(n) => setState((p) => ({ ...p, targetVotes: n }))} />
            </div>
          </div>
          <div className="mt-4 flex items-baseline justify-between border-t-[3px] border-dashed border-gold pt-3">
            <span className="font-serif text-base font-bold text-ink-soft">行程累計估票</span>
            <span className="font-serif text-2xl font-black tabular-nums text-campaign">
              {nf(totals.funnel.low)} ~ {nf(totals.funnel.high)} 票
            </span>
          </div>
          {state.targetVotes > 0 && (
            <p className="mt-2 border-l-[3px] border-gold bg-paper px-3 py-2 text-[13px] leading-relaxed text-ink-soft">
              {gap > 0 ? (
                <>
                  離目標約差 <b className="font-serif text-ink tabular-nums">{nf(gap)}</b> 票。以輕承諾中位轉換率 15%
                  回推，接下來平均每天要新增約{' '}
                  <b className="font-serif text-campaign tabular-nums">{nf(dailyLine)}</b> 位加 LINE／留聯絡的里民。
                </>
              ) : (
                <>估票區間已涵蓋目標——別鬆懈，持續鞏固並回頭核實每一階的真實轉換。</>
              )}
            </p>
          )}
          <p className="mt-2 text-[11px] text-ink-soft/60">
            估票邏輯與轉換率區間跟計算機「陸戰漏斗」同一套，公開可查；建議用你的實測數據回頭校準。
          </p>
        </Panel>

        {/* ② 行程總覽（Day 卡）*/}
        <Panel>
          <div className="flex items-center justify-between">
            <SectionTag no="②" label="行程總覽" />
            <div className="flex gap-2">
              <button
                onClick={generateWeek}
                title="依每日配額與常識時段，生成未來 7 天行程草稿（已排的日子跳過）"
                className="cursor-pointer border-[3px] border-ink bg-white px-3 py-1 font-serif text-sm font-black text-ink hover:bg-paper"
              >
                ⚡ 排本週草稿
              </button>
              <button
                onClick={() => {
                  setFormOpen((o) => !o);
                  setEditingId(null);
                  setDraft(emptyDraft());
                }}
                className="cursor-pointer border-[3px] border-ink bg-gold px-3 py-1 font-serif text-sm font-black text-ink hover:bg-gold-soft"
              >
                {formOpen ? '收起' : '＋ 新增行程'}
              </button>
            </div>
          </div>

          {formOpen && (
            <div className="mt-4 space-y-3 border-[3px] border-dashed border-ink/40 bg-paper p-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="日期">
                  <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} className={inputCls} />
                </Field>
                <Field label="開始時間（選填）">
                  <input type="time" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} className={inputCls} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="行程類型">
                  <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as StopType })} className={`${inputCls} cursor-pointer appearance-none`}>
                    {STOP_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="鄰別/區塊（熱區用，選填）">
                  <input value={draft.hood} onChange={(e) => setDraft({ ...draft, hood: e.target.value })} placeholder="例：第5鄰" className={inputCls} />
                </Field>
              </div>
              <Field label="地點/場次名稱">
                <input value={draft.place} onChange={(e) => setDraft({ ...draft, place: e.target.value })} placeholder="例：全家路口、黃昏市場入口" className={inputCls} />
              </Field>
              <div className="flex items-center justify-between gap-3 border-y-[3px] border-dashed border-ink/20 py-2">
                <label className="flex cursor-pointer items-center gap-2 text-[13px] font-bold text-ink">
                  <input
                    type="checkbox"
                    checked={draft.done}
                    onChange={(e) => setDraft({ ...draft, done: e.target.checked })}
                    className="h-4 w-4 accent-[var(--color-campaign)]"
                  />
                  已執行（以下數字為實績）
                </label>
                <div className="w-24">
                  <Field label="預計接觸">
                    <NumInput value={draft.planned} onChange={(n) => setDraft({ ...draft, planned: n })} />
                  </Field>
                </div>
              </div>
              {draft.done && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Field label="接觸人次">
                    <NumInput value={draft.contacts} onChange={(n) => setDraft({ ...draft, contacts: n })} />
                  </Field>
                  <Field label="加 LINE">
                    <NumInput value={draft.line} onChange={(n) => setDraft({ ...draft, line: n })} />
                  </Field>
                  <Field label="連署/推薦">
                    <NumInput value={draft.pledges} onChange={(n) => setDraft({ ...draft, pledges: n })} />
                  </Field>
                  <Field label="志工報名">
                    <NumInput value={draft.volunteers} onChange={(n) => setDraft({ ...draft, volunteers: n })} />
                  </Field>
                </div>
              )}
              <div className="grid grid-cols-2 items-end gap-3">
                <Field label="花費（元）">
                  <NumInput value={draft.cost} onChange={(n) => setDraft({ ...draft, cost: n })} />
                </Field>
                <Field label="這個點的好感度（掛地點，不評住戶）">
                  <Stars value={draft.rating} onChange={(n) => setDraft({ ...draft, rating: n })} />
                </Field>
              </div>
              <Field label="備註/商家互動（例：麵店老闆願意掛旗）">
                <input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} className={inputCls} />
              </Field>
              <button
                onClick={saveDraft}
                disabled={!draft.place.trim()}
                className="w-full cursor-pointer border-[3px] border-ink bg-campaign py-2.5 font-serif text-base font-black tracking-widest text-paper hover:bg-campaign-dark disabled:cursor-not-allowed disabled:opacity-40"
              >
                {editingId ? '儲存修改' : '加入行程'}
              </button>
            </div>
          )}

          {byDate.length === 0 && !formOpen && (
            <div className="mt-4 border-[3px] border-dashed border-ink/30 p-6 text-center">
              <div className="text-3xl">🗺️</div>
              <p className="mt-2 font-serif text-base font-black text-ink">還沒有行程</p>
              <p className="mt-1 text-xs text-ink-soft">按「＋ 新增行程」，排下你的 Day 1。</p>
            </div>
          )}

          <div className="mt-4 space-y-4">
            {byDate.map(([date, stops], di) => {
              const doneStops = stops.filter((x) => x.done);
              const plannedCount = stops.length - doneStops.length;
              const dayContacts = doneStops.reduce((s, x) => s + x.contacts, 0);
              const dayLine = doneStops.reduce((s, x) => s + x.line, 0);
              const dayCost = doneStops.reduce((s, x) => s + x.cost, 0);
              return (
                <div key={date}>
                  <div className="flex items-baseline justify-between border-b-[3px] border-ink pb-1">
                    <p className="font-serif text-base font-black text-ink">
                      Day {di + 1} <span className="ml-1 text-sm font-bold text-ink-soft">{dateLabel(date)}</span>
                    </p>
                    <p className="text-[11px] text-ink-soft tabular-nums">
                      {doneStops.length > 0 && <>接觸 {nf(dayContacts)} · 加LINE {nf(dayLine)} · ${nf(dayCost)}</>}
                      {doneStops.length > 0 && plannedCount > 0 && ' · '}
                      {plannedCount > 0 && <>📌 計畫 {plannedCount} 場</>}
                    </p>
                  </div>
                  <div className="divide-y divide-paper-line">
                    {stops.map((s) => (
                      <div key={s.id} className={`flex items-start gap-2 py-2 ${s.done ? '' : 'opacity-90'}`}>
                        <span className="mt-0.5 w-11 shrink-0 font-serif text-[13px] font-bold text-ink-soft tabular-nums">
                          {s.start || '—'}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[14px] font-bold text-ink">
                            <span className={`mr-1.5 px-1.5 py-0.5 text-[11px] font-black ${s.done ? 'bg-paper text-ink-soft' : 'border border-dashed border-ink/50 text-ink-soft'}`}>
                              {s.done ? s.type : `📌 ${s.type}`}
                            </span>
                            {s.place}
                            {s.hood && <span className="ml-1 text-xs font-medium text-ink-soft">（{s.hood}）</span>}
                          </p>
                          {s.done ? (
                            <p className="mt-0.5 text-[12px] text-ink-soft tabular-nums">
                              接觸 {nf(s.contacts)}
                              {s.planned > 0 && <span className="text-ink-soft/60">（預計 {nf(s.planned)}）</span>}
                              ｜LINE +{nf(s.line)}｜連署 +{nf(s.pledges)}｜志工 +{nf(s.volunteers)}
                              {s.cost > 0 && <>｜${nf(s.cost)}</>}
                            </p>
                          ) : (
                            <p className="mt-0.5 text-[12px] text-ink-soft tabular-nums">
                              預計接觸 {nf(s.planned)}
                              {s.cost > 0 && <>｜預算 ${nf(s.cost)}</>}
                            </p>
                          )}
                          {s.rating > 0 && <Stars value={s.rating} />}
                          {s.note && <p className="mt-0.5 text-[12px] text-ink-soft/80">💬 {s.note}</p>}
                        </div>
                        <div className="flex shrink-0 gap-1.5 text-[11px] font-bold">
                          {!s.done && (
                            <button onClick={() => checkIn(s)} className="cursor-pointer border-[2px] border-campaign px-1.5 py-0.5 text-campaign hover:bg-campaign hover:text-paper">
                              ✓ 打卡
                            </button>
                          )}
                          <button onClick={() => edit(s)} className="cursor-pointer text-ink-soft underline decoration-dotted hover:text-ink">
                            編輯
                          </button>
                          <button onClick={() => remove(s.id)} className="cursor-pointer text-campaign underline decoration-dotted hover:text-campaign-dark">
                            刪除
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        {/* ③ 好感度熱區 */}
        {hotspots.length > 0 && (
          <Panel>
            <SectionTag no="③" label="好感度熱區" />
            <p className="mt-1.5 text-xs text-ink-soft">反應最好的鄰/地點——辦活動、募志工從這裡優先邀。</p>
            <div className="mt-3 divide-y divide-paper-line">
              {hotspots.map((h, i) => (
                <div key={h.key} className="flex items-center justify-between gap-2 py-2">
                  <span className="flex items-center gap-2 text-sm font-bold text-ink">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center bg-ink font-serif text-[12px] font-black text-paper">
                      {i + 1}
                    </span>
                    {h.key}
                  </span>
                  <span className="text-right text-[12px] text-ink-soft tabular-nums">
                    {h.avgRating > 0 && <Stars value={Math.round(h.avgRating)} />}
                    <span className="ml-2">
                      去過 {h.visits} 次 · LINE +{nf(h.line)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {/* ④ 總帳 */}
        <Panel>
          <SectionTag no="④" label="選戰總帳" />
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              { label: '總接觸', val: nf(totals.contacts) },
              { label: '加 LINE', val: nf(totals.line) },
              { label: '連署', val: nf(totals.pledges) },
              { label: '志工', val: nf(totals.volunteers) },
              { label: '總花費', val: `$${nf(totals.cost)}` },
            ].map((x) => (
              <div key={x.label} className="border-[3px] border-ink bg-paper p-2 text-center">
                <p className="text-[11px] font-bold text-ink-soft">{x.label}</p>
                <p className="font-serif text-lg font-black text-ink tabular-nums">{x.val}</p>
              </div>
            ))}
          </div>
        </Panel>

        {/* 免責與個資聲明 */}
        <footer className="space-y-1 px-1 text-center text-[11px] leading-relaxed text-ink-soft/70">
          <p>本工具只記錄你自己的行動與匿名統計，請勿記載個別住戶的政治傾向（個資法第 6 條特種個資）。</p>
          <p>所有資料只存在這台裝置的瀏覽器（localStorage），不上傳任何伺服器；換裝置或清除瀏覽資料即消失。</p>
        </footer>
      </div>
    </div>
  );
}
