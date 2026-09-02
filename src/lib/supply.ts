// 競選小物採購與庫存 — 純邏輯層
//
// 補上鏈條缺的一環：採購（廠商）→ 庫存 → 鋪點（商家）→ 補貨 → 回訪。
// 原本 App 假設小物憑空存在，補貨時直接填數量；實際上候選人掃街到一半
// 最常問的是「後車廂還剩幾包」。而每一筆採購金額同時就是競選經費帳的
// 原始資料（政治獻金法選後 30 天申報要用）。
//
// ⚠️ 兩個寫進型別裡的法遵提醒：
//  - relation='關係人'：向親屬經營的廠商採購本身合法，但價格明顯低於市場
//    行情時，差額可能被認定為實物捐贈。標記出來，不要事後才想起。
//  - 這裡算的是「試算」不是正式報價。規格（幾色、材質、版費）會改變價格，
//    畫面必須明講，否則做出來的是比沒有更糟的假精確。

export const QUOTE_DISCLAIMER = '此為依價目表級距的試算，正式報價以廠商回覆為準（規格、材質、版費會影響價格）。';
export const RELATED_PARTY_WARNING = '關係人交易：價格需符合市場行情，明顯低價的差額可能被認定為實物捐贈。';

export const SUPPLIER_RELATIONS = ['一般', '關係人'] as const;
export type SupplierRelation = (typeof SUPPLIER_RELATIONS)[number];

export interface PriceTier {
  minQty: number; // 此級距的起訂量
  unitPrice: number; // 該級距單價
}

export interface SupplyItem {
  item: string; // 品項名，對應 merchants.ts 的 ITEMS
  unit: string; // 單位：包/支/件
  tiers: PriceTier[];
  setupFee: number; // 版費/開版費，一次性
  note: string;
}

export interface Supplier {
  id: string;
  orgId: string;
  name: string;
  contact: string;
  url: string;
  relation: SupplierRelation;
  items: SupplyItem[];
  note: string;
}

export interface Purchase {
  id: string;
  orgId: string;
  supplierId: string;
  supplierName: string; // 冗餘存一份，廠商刪掉後帳still看得懂
  item: string;
  qty: number;
  unitPrice: number;
  setupFee: number;
  total: number;
  orderedAt: string; // YYYY-MM-DD
  note: string;
  by: string;
}

export interface Quote {
  unitPrice: number;
  subtotal: number;
  setupFee: number;
  total: number;
  tierMin: number; // 套用到的級距起訂量
  belowMin: boolean; // 數量低於最低級距（廠商可能不接單）
}

function sortedTiers(item: SupplyItem): PriceTier[] {
  return [...item.tiers].sort((a, b) => a.minQty - b.minQty);
}

// 級距取「起訂量 ≤ 數量」中最大的那一級；不足最低級距則沿用最低級距單價並標記。
export function quote(item: SupplyItem, qty: number): Quote {
  const tiers = sortedTiers(item);
  if (tiers.length === 0 || qty <= 0) {
    return { unitPrice: 0, subtotal: 0, setupFee: 0, total: 0, tierMin: 0, belowMin: false };
  }
  let picked = tiers[0];
  let belowMin = qty < tiers[0].minQty;
  for (const t of tiers) {
    if (qty >= t.minQty) picked = t;
  }
  const subtotal = picked.unitPrice * qty;
  return {
    unitPrice: picked.unitPrice,
    subtotal,
    setupFee: item.setupFee,
    total: subtotal + item.setupFee,
    tierMin: picked.minQty,
    belowMin,
  };
}

export interface TierHint {
  minQty: number;
  unitPrice: number;
  needMore: number; // 還差幾件進下一級
  totalAtNextTier: number;
  cheaperOverall: boolean; // 買更多反而總價更低（級距落差大時真的會發生）
}

// 下一個級距的提示。cheaperOverall 是這裡真正有用的資訊——
// 差 20 件卻能讓總價下降時，候選人自己算不出來。
export function nextTierHint(item: SupplyItem, qty: number): TierHint | null {
  const tiers = sortedTiers(item);
  const next = tiers.find((t) => t.minQty > qty);
  if (!next) return null;
  const nowTotal = quote(item, qty).total;
  const nextTotal = quote(item, next.minQty).total;
  return {
    minQty: next.minQty,
    unitPrice: next.unitPrice,
    needMore: next.minQty - qty,
    totalAtNextTier: nextTotal,
    cheaperOverall: nextTotal < nowTotal,
  };
}

export interface Stock {
  item: string;
  bought: number;
  placed: number;
  left: number; // 可能為負：代表鋪出去的比帳上買的多，帳沒對齊
}

export function inventory(
  purchases: ReadonlyArray<Pick<Purchase, 'item' | 'qty'>>,
  placements: ReadonlyArray<{ item: string; qty: number }>,
): Stock[] {
  const map = new Map<string, Stock>();
  const touch = (item: string) =>
    map.get(item) ?? (map.set(item, { item, bought: 0, placed: 0, left: 0 }), map.get(item)!);
  for (const p of purchases) touch(p.item).bought += p.qty;
  for (const p of placements) touch(p.item).placed += p.qty;
  for (const s of map.values()) s.left = s.bought - s.placed;
  return [...map.values()].sort((a, b) => a.item.localeCompare(b.item, 'zh-Hant'));
}

export function totalSpend(purchases: ReadonlyArray<Pick<Purchase, 'total'>>): number {
  return purchases.reduce((n, p) => n + p.total, 0);
}

// 剩下的量還夠鋪幾家（用實際平均每家鋪出量估，沒資料就回 null 不瞎猜）
export function shopsCovered(left: number, placements: ReadonlyArray<{ item: string; qty: number; merchantId: string }>, item: string): number | null {
  const rows = placements.filter((p) => p.item === item);
  if (rows.length === 0 || left <= 0) return null;
  const avg = rows.reduce((n, p) => n + p.qty, 0) / rows.length;
  return avg > 0 ? Math.floor(left / avg) : null;
}

// 需求單：一鍵複製傳給廠商。刻意含免責句，避免試算被當成議價籌碼。
export function requestText(o: {
  supplierName: string;
  candidate: string;
  item: string;
  unit: string;
  qty: number;
  q: Quote;
  needBy: string;
  note: string;
}): string {
  return [
    `${o.supplierName} 您好，我是${o.candidate || '〔請補：候選人〕'}。`,
    '',
    `想詢問報價：${o.item} ${o.qty} ${o.unit || '件'}`,
    `我方依貴公司價目表試算：單價 ${o.q.unitPrice} 元${o.q.setupFee > 0 ? `，版費 ${o.q.setupFee} 元` : ''}，合計約 ${o.q.total} 元。`,
    o.needBy ? `希望交期：${o.needBy}` : '',
    o.note ? `備註：${o.note}` : '',
    '',
    '以上試算僅供對照，實際報價與規格請以您這邊為準，謝謝。',
  ]
    .filter((l) => l !== '')
    .join('\n');
}
