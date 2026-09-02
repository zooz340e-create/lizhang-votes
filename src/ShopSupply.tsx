// 備料 — 採購／庫存介面層
//
// 補上鏈條缺的一環：採購（廠商）→ 庫存 → 鋪點（商家）→ 補貨。
// 掃街到一半最常問的是「後車廂還剩幾包」，而每筆採購金額同時就是
// 競選經費帳的原始資料。
//
// 試算不是報價：規格、材質、版費都會改變價格，畫面必須明講，
// 否則做出來的是比沒有更糟的假精確。

import { useMemo, useState } from 'react';
import { ITEMS } from './lib/merchants.ts';
import type { CandidateProfile } from './lib/letters.ts';
import {
  QUOTE_DISCLAIMER, RELATED_PARTY_WARNING, SUPPLIER_RELATIONS,
  inventory, nextTierHint, quote, requestText, shopsCovered, totalSpend,
  type Purchase, type SupplyItem, type Supplier, type SupplierRelation,
} from './lib/supply.ts';
import { Field, Sheet, copyText, inputCls } from './ShopUI.tsx';

const nt = (n: number) => `NT$${Math.round(n).toLocaleString('en-US')}`;

export function SupplyTab({
  orgId,
  suppliers,
  purchases,
  placements,
  profile,
  operator,
  todayISO,
  onSaveSupplier,
  onRemoveSupplier,
  onAddPurchase,
}: {
  orgId: string;
  suppliers: ReadonlyArray<Supplier>;
  purchases: ReadonlyArray<Purchase>;
  placements: ReadonlyArray<{ item: string; qty: number; merchantId: string }>;
  profile: CandidateProfile;
  operator: string;
  todayISO: string;
  onSaveSupplier: (s: Supplier) => void;
  onRemoveSupplier: (id: string) => void;
  onAddPurchase: (p: Omit<Purchase, 'id'>) => void;
}) {
  const [editing, setEditing] = useState<Supplier | null>(null);
  const stocks = useMemo(() => inventory(purchases, placements), [purchases, placements]);
  const spend = totalSpend(purchases);

  function blankSupplier(): Supplier {
    return { id: crypto.randomUUID(), orgId, name: '', contact: '', url: '', relation: '一般', items: [], note: '' };
  }

  return (
    <div className="mt-3 space-y-4">
      {/* 庫存 */}
      <section>
        <h2 className="font-serif text-base font-black">庫存</h2>
        {stocks.length === 0 ? (
          <p className="mt-2 rounded-xl border border-dashed border-paper-line px-4 py-6 text-center text-sm text-ink-soft/70">
            還沒有採購紀錄。下面先建廠商與價目表，訂完在試算器按「記為已採購」。
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {stocks.map((s) => {
              const covers = shopsCovered(s.left, placements, s.item);
              const short = s.left < 0;
              return (
                <li key={s.item} className={`rounded-xl border p-3 ${short ? 'border-campaign/50 bg-campaign/5' : 'border-paper-line bg-white/70'}`}>
                  <div className="flex items-baseline justify-between">
                    <span className="font-medium">{s.item}</span>
                    <span className={`font-serif text-xl font-black ${short ? 'text-campaign' : ''}`}>
                      剩 {s.left}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-soft/75">
                    買 {s.bought} · 鋪 {s.placed}
                    {covers != null ? ` · 還夠鋪約 ${covers} 家` : ''}
                    {short ? ' · 鋪出去的比帳上買的多，採購紀錄漏記了' : ''}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        {purchases.length > 0 && (
          <p className="mt-2 text-xs text-ink-soft/75">
            小物累計支出 {nt(spend)} —— 這是選後經費申報的原始資料，別另外再記一份。
          </p>
        )}
      </section>

      {/* 試算器 */}
      {suppliers.some((s) => s.items.length > 0) && (
        <Calculator
          suppliers={suppliers}
          profile={profile}
          operator={operator}
          todayISO={todayISO}
          orgId={orgId}
          onAddPurchase={onAddPurchase}
        />
      )}

      {/* 廠商 */}
      <section>
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-base font-black">配合廠商</h2>
          <button onClick={() => setEditing(blankSupplier())} className="rounded-lg border border-ink/60 px-3 py-1.5 text-sm">
            ＋ 新增廠商
          </button>
        </div>
        <ul className="mt-2 space-y-2">
          {suppliers.length === 0 && (
            <li className="rounded-xl border border-dashed border-paper-line px-4 py-6 text-center text-sm text-ink-soft/70">
              還沒有廠商。跟廠商要「數量級距報價」再填進來，試算才會準。
            </li>
          )}
          {suppliers.map((s) => (
            <li key={s.id} className="rounded-xl border border-paper-line bg-white/70 p-3">
              <div className="flex items-baseline gap-2">
                <span className="font-medium">{s.name || '（未命名）'}</span>
                {s.relation === '關係人' && (
                  <span className="rounded-full border border-campaign/50 px-2 py-0.5 text-[11px] text-campaign">關係人</span>
                )}
                <button onClick={() => setEditing(s)} className="ml-auto text-sm text-ink-soft underline">編輯</button>
              </div>
              <p className="mt-0.5 text-xs text-ink-soft/75">
                {[s.contact, `${s.items.length} 個品項`].filter(Boolean).join(' · ')}
              </p>
              {s.url && (
                <a href={s.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-ink-soft underline">
                  開啟廠商連結
                </a>
              )}
              {s.relation === '關係人' && (
                <p className="mt-1 text-[11px] text-campaign/90">{RELATED_PARTY_WARNING}</p>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* 採購紀錄 */}
      {purchases.length > 0 && (
        <section>
          <h2 className="font-serif text-base font-black">採購紀錄</h2>
          <ul className="mt-2 space-y-1 text-xs text-ink-soft/80">
            {[...purchases].reverse().map((p) => (
              <li key={p.id} className="flex justify-between rounded-lg border border-paper-line bg-white/60 px-3 py-2">
                <span>{p.orderedAt} · {p.supplierName} · {p.item} × {p.qty}</span>
                <span className="font-medium">{nt(p.total)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {editing && (
        <SupplierSheet
          supplier={editing}
          onClose={() => setEditing(null)}
          onSave={(s) => { onSaveSupplier(s); setEditing(null); }}
          onRemove={(id) => { onRemoveSupplier(id); setEditing(null); }}
        />
      )}
    </div>
  );
}

// ── 試算器 ─────────────────────────────────────────────────
function Calculator({
  suppliers,
  profile,
  operator,
  todayISO,
  orgId,
  onAddPurchase,
}: {
  suppliers: ReadonlyArray<Supplier>;
  profile: CandidateProfile;
  operator: string;
  todayISO: string;
  orgId: string;
  onAddPurchase: (p: Omit<Purchase, 'id'>) => void;
}) {
  const usable = suppliers.filter((s) => s.items.length > 0);
  const [supplierId, setSupplierId] = useState(usable[0]?.id ?? '');
  const supplier = usable.find((s) => s.id === supplierId) ?? usable[0];
  const [itemName, setItemName] = useState(supplier?.items[0]?.item ?? '');
  const item: SupplyItem | undefined =
    supplier?.items.find((i) => i.item === itemName) ?? supplier?.items[0];
  const [qty, setQty] = useState(500);
  const [needBy, setNeedBy] = useState('');
  const [msg, setMsg] = useState('');

  if (!supplier || !item) return null;
  const q = quote(item, qty);
  const hint = nextTierHint(item, qty);

  async function copyRequest() {
    const text = requestText({
      supplierName: supplier!.name, candidate: profile.name, item: item!.item,
      unit: item!.unit, qty, q, needBy, note: item!.note,
    });
    setMsg((await copyText(text)) ? '需求單已複製，貼給廠商即可' : '複製失敗，請長按選取');
  }

  function record() {
    onAddPurchase({
      orgId, supplierId: supplier!.id, supplierName: supplier!.name, item: item!.item,
      qty, unitPrice: q.unitPrice, setupFee: q.setupFee, total: q.total,
      orderedAt: todayISO, note: '', by: operator || '未署名',
    });
    setMsg(`已記入採購：${item!.item} × ${qty}，${nt(q.total)}`);
  }

  return (
    <section className="rounded-xl border border-paper-line bg-white/70 p-3">
      <h2 className="font-serif text-base font-black">報價試算</h2>
      <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
        <Field label="廠商">
          <select
            value={supplier.id}
            onChange={(e) => {
              setSupplierId(e.target.value);
              const s = usable.find((x) => x.id === e.target.value);
              setItemName(s?.items[0]?.item ?? '');
            }}
            className={inputCls}
          >
            {usable.map((s) => <option key={s.id} value={s.id}>{s.name || '（未命名）'}</option>)}
          </select>
        </Field>
        <Field label="品項">
          <select value={item.item} onChange={(e) => setItemName(e.target.value)} className={inputCls}>
            {supplier.items.map((i) => <option key={i.item} value={i.item}>{i.item}</option>)}
          </select>
        </Field>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
        <Field label={`數量（${item.unit || '件'}）`}>
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
            className={inputCls}
          />
        </Field>
        <Field label="希望交期">
          <input type="date" value={needBy} onChange={(e) => setNeedBy(e.target.value)} className={inputCls} />
        </Field>
      </div>

      <div className="mt-3 rounded-lg border border-paper-line bg-paper px-3 py-2">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-ink-soft">
            單價 {q.unitPrice} × {qty}
            {q.setupFee > 0 ? ` ＋ 版費 ${nt(q.setupFee)}` : ''}
          </span>
          <span className="font-serif text-2xl font-black">{nt(q.total)}</span>
        </div>
        {q.belowMin && (
          <p className="mt-1 text-xs text-campaign">數量低於最低級距 {q.tierMin}，廠商可能不接單或另外報價。</p>
        )}
        {hint && (
          <p className={`mt-1 text-xs ${hint.cheaperOverall ? 'text-campaign' : 'text-ink-soft/75'}`}>
            再多 {hint.needMore} {item.unit || '件'} 進下一級距，單價 {hint.unitPrice}，總價 {nt(hint.totalAtNextTier)}
            {hint.cheaperOverall ? ` —— 買更多反而省 ${nt(q.total - hint.totalAtNextTier)}` : ''}
          </p>
        )}
      </div>
      <p className="mt-2 text-[11px] text-ink-soft/70">{QUOTE_DISCLAIMER}</p>

      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        <button onClick={copyRequest} className="rounded-lg bg-ink px-4 py-2.5 font-medium text-paper">複製需求單</button>
        <button onClick={record} className="rounded-lg border border-ink/60 px-4 py-2.5">記為已採購</button>
      </div>
      {msg && <p className="mt-2 text-xs text-ink-soft">{msg}</p>}
    </section>
  );
}

// ── 廠商編輯（含價目表級距）──────────────────────────────────
function SupplierSheet({
  supplier,
  onClose,
  onSave,
  onRemove,
}: {
  supplier: Supplier;
  onClose: () => void;
  onSave: (s: Supplier) => void;
  onRemove: (id: string) => void;
}) {
  const [d, setD] = useState<Supplier>(supplier);
  const set = <K extends keyof Supplier>(k: K, v: Supplier[K]) => setD((p) => ({ ...p, [k]: v }));

  function setItem(idx: number, next: SupplyItem) {
    setD((p) => ({ ...p, items: p.items.map((it, i) => (i === idx ? next : it)) }));
  }
  function addItem() {
    const used = new Set(d.items.map((i) => i.item));
    const fresh = ITEMS.map((i) => i.name).find((n) => !used.has(n)) ?? '其他';
    setD((p) => ({
      ...p,
      items: [...p.items, { item: fresh, unit: '件', tiers: [{ minQty: 100, unitPrice: 0 }], setupFee: 0, note: '' }],
    }));
  }

  return (
    <Sheet title={supplier.name || '新增廠商'} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <Field label="廠商名稱">
          <input value={d.name} onChange={(e) => set('name', e.target.value)} className={inputCls} placeholder="大同印刷輸出" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="聯絡方式">
            <input value={d.contact} onChange={(e) => set('contact', e.target.value)} className={inputCls} placeholder="04-xxxx / LINE" />
          </Field>
          <Field label="關係">
            <select value={d.relation} onChange={(e) => set('relation', e.target.value as SupplierRelation)} className={inputCls}>
              {SUPPLIER_RELATIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
        </div>
        {d.relation === '關係人' && (
          <p className="rounded-lg border border-campaign/40 bg-campaign/5 px-3 py-2 text-xs text-campaign">
            {RELATED_PARTY_WARNING}
          </p>
        )}
        <Field label="廠商連結（型錄、網站）">
          <input value={d.url} onChange={(e) => set('url', e.target.value)} className={inputCls} placeholder="https://…" />
        </Field>

        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-soft/80">價目表（數量級距）</span>
            <button onClick={addItem} className="rounded-lg border border-ink/60 px-2.5 py-1 text-xs">＋ 品項</button>
          </div>
          <div className="mt-2 space-y-3">
            {d.items.map((it, idx) => (
              <div key={idx} className="rounded-lg border border-paper-line bg-white p-3">
                <div className="grid grid-cols-3 gap-2">
                  <Field label="品項">
                    <input value={it.item} onChange={(e) => setItem(idx, { ...it, item: e.target.value })} className={inputCls} />
                  </Field>
                  <Field label="單位">
                    <input value={it.unit} onChange={(e) => setItem(idx, { ...it, unit: e.target.value })} className={inputCls} placeholder="包" />
                  </Field>
                  <Field label="版費">
                    <input
                      type="number"
                      value={it.setupFee}
                      onChange={(e) => setItem(idx, { ...it, setupFee: Number(e.target.value) || 0 })}
                      className={inputCls}
                    />
                  </Field>
                </div>
                <p className="mt-2 text-xs text-ink-soft/80">級距：滿 N 件的單價</p>
                {it.tiers.map((t, ti) => (
                  <div key={ti} className="mt-1 flex items-center gap-2">
                    <span className="text-xs">滿</span>
                    <input
                      type="number"
                      value={t.minQty}
                      onChange={(e) =>
                        setItem(idx, {
                          ...it,
                          tiers: it.tiers.map((x, i) => (i === ti ? { ...x, minQty: Number(e.target.value) || 0 } : x)),
                        })
                      }
                      className="w-24 rounded-lg border border-paper-line px-2 py-1.5"
                    />
                    <span className="text-xs">件，單價</span>
                    <input
                      type="number"
                      step="0.1"
                      value={t.unitPrice}
                      onChange={(e) =>
                        setItem(idx, {
                          ...it,
                          tiers: it.tiers.map((x, i) => (i === ti ? { ...x, unitPrice: Number(e.target.value) || 0 } : x)),
                        })
                      }
                      className="w-24 rounded-lg border border-paper-line px-2 py-1.5"
                    />
                    <button
                      onClick={() => setItem(idx, { ...it, tiers: it.tiers.filter((_, i) => i !== ti) })}
                      className="ml-auto text-xs text-ink-soft underline"
                    >
                      刪除
                    </button>
                  </div>
                ))}
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => setItem(idx, { ...it, tiers: [...it.tiers, { minQty: 0, unitPrice: 0 }] })}
                    className="rounded-lg border border-paper-line px-2.5 py-1 text-xs"
                  >
                    ＋ 級距
                  </button>
                  <button
                    onClick={() => setD((p) => ({ ...p, items: p.items.filter((_, i) => i !== idx) }))}
                    className="rounded-lg border border-campaign/40 px-2.5 py-1 text-xs text-campaign"
                  >
                    刪除品項
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <Field label="備註">
          <textarea value={d.note} onChange={(e) => set('note', e.target.value)} rows={2} className={inputCls} />
        </Field>

        <div className="flex gap-2 pt-1">
          <button onClick={() => onSave(d)} className="flex-1 rounded-lg bg-ink py-3 font-medium text-paper">儲存</button>
          <button
            onClick={() => { if (confirm(`刪除廠商「${d.name}」？採購紀錄會保留。`)) onRemove(d.id); }}
            className="rounded-lg border border-campaign/50 px-4 py-3 text-campaign"
          >
            刪除
          </button>
        </div>
      </div>
    </Sheet>
  );
}
