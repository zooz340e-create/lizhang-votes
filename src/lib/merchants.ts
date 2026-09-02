// 友善商家地圖 — 純邏輯層（純函式，無 DOM 依賴，可單元測試）
//
// 產品定位：候選人 CRM 的第一個模組。跟 plan.ts（選戰行程規劃）是姊妹關係——
// 行程裡的「商家拜訪」型態，拜訪的就是這裡的商家。
//
// 兩個設計前提，寫死在型別裡而不是靠人記得：
//  1.【互惠不是單向拜託】商家用陳列空間換「友善店家」公開頁的曝光。所以
//     publicConsent 是明示、有版本、有時間戳的物件，預設不同意；未明示同意
//     的商家永遠不會出現在公開頁。
//  2.【多里隔離】每筆資料都掛 orgId（候選人 × 里）。介面第一版只做台鳳里，
//     但資料結構從第一天就能裝下一批練習生，事後補要打掉重練。
//
// ⚠️ 未決法律問題（見 plans/2026-09-02-友善商家地圖.md）：商家無償提供陳列
// 空間是否構成政治獻金法上的實物捐贈、公開頁曝光是否構成對商家的對價。
// considerationNote 欄位為此預留；在這條線畫定前，公開頁不上線。

export const STANCES = ['友善', '中立', '婉拒'] as const;
export type Stance = (typeof STANCES)[number];

export const CATEGORIES = [
  '早餐店', '便當/小吃', '雜貨/柑仔店', '超商', '美髮/美容',
  '診所/藥局', '宮廟', '機車行/修車', '五金/水電', '市場攤商', '其他',
] as const;
export type Category = (typeof CATEGORIES)[number];

// 競選小物與預設回訪週期（天）。週期＝「大約幾天該回去看一次」，
// 不是消耗速率預測——我們沒有那個資料，不假裝有。可逐筆覆寫。
export const ITEMS = [
  { name: '衛生紙', cycleDays: 14 },
  { name: '手機架', cycleDays: 30 },
  { name: '扇子', cycleDays: 14 },
  { name: '面紙套', cycleDays: 21 },
  { name: '名片/文宣', cycleDays: 10 },
  { name: '其他', cycleDays: 14 },
] as const;
export type ItemName = (typeof ITEMS)[number]['name'];

export function cycleDaysOf(item: string): number {
  return ITEMS.find((i) => i.name === item)?.cycleDays ?? 14;
}

// 公開同意的說明文字。改字必須同時進版號——舊資料留著舊版號，
// 才知道當初商家同意的到底是哪一段話。
export const CONSENT_VERSION = 'v1-2026-09-02';
export const CONSENT_TEXT =
  '本店同意將店名、地址、營業時間與一句店家介紹刊登於「友善店家」公開頁面，作為店家曝光之用；本店可隨時要求下架。';

export interface Consent {
  granted: boolean;
  at: string; // ISO 日期時間，取得同意的當下
  version: string; // 取得同意時的 CONSENT_VERSION
  by: string; // 誰在現場取得的（候選人/志工名）
}

export interface Merchant {
  id: string;
  orgId: string; // 候選人 × 里
  name: string; // 店名（唯一必填）
  category: Category | '';
  address: string;
  lat: number | null;
  lng: number | null;
  hood: string; // 鄰別/區塊，與 plan.ts 的 Stop.hood 同一套口徑
  contactTitle: string; // 負責人稱謂（「陳老闆」「阿姨」），刻意不收姓名全名
  phone: string;
  hours: string; // 營業時間（公開頁用）
  stance: Stance;
  blurb: string; // 一句店家介紹（公開頁用）
  publicConsent: Consent;
  considerationNote: string; // 對價說明（法遵預留）
  note: string; // 內部備註，永不進公開頁
  retainUntil: string; // 保存期限 YYYY-MM-DD，到期提示匯出後刪除
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface Placement {
  id: string;
  orgId: string;
  merchantId: string;
  item: string;
  qty: number;
  placedAt: string; // YYYY-MM-DD
  refillDays: number; // 回訪週期，預設取 cycleDaysOf(item)
  by: string;
}

export interface Visit {
  id: string;
  orgId: string;
  merchantId: string;
  at: string; // YYYY-MM-DD
  by: string;
  result: '補貨' | '寒暄' | '婉拒' | '沒開門' | '其他';
  note: string;
}

export const NO_CONSENT: Consent = { granted: false, at: '', version: '', by: '' };

export function grantConsent(by: string, nowISO: string): Consent {
  return { granted: true, at: nowISO, version: CONSENT_VERSION, by };
}

// ── 日期工具（全部走 YYYY-MM-DD 字串，避開時區踩雷）───────────────

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(`${fromISO}T00:00:00`).getTime();
  const b = new Date(`${toISO}T00:00:00`).getTime();
  return Math.round((b - a) / 86400000);
}

// 保存期限：預設投票日 + 6 個月。選後資料不該無限期躺著。
export function retainUntilISO(electionDayISO: string, months = 6): string {
  const d = new Date(`${electionDayISO}T00:00:00`);
  d.setMonth(d.getMonth() + months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── 補貨狀態 ────────────────────────────────────────────────

export type RefillStatus = 'overdue' | 'due' | 'soon' | 'ok' | 'none';

export function dueDateOf(p: Placement): string {
  return addDays(p.placedAt, p.refillDays);
}

// 最近一次鋪點（同一商家可能鋪過多種小物，取最晚放置的那筆）
export function latestPlacement(
  merchantId: string,
  placements: ReadonlyArray<Placement>,
): Placement | null {
  let best: Placement | null = null;
  for (const p of placements) {
    if (p.merchantId !== merchantId) continue;
    if (!best || p.placedAt > best.placedAt) best = p;
  }
  return best;
}

export function refillStatus(todayISO: string, dueISO: string | null): RefillStatus {
  if (!dueISO) return 'none';
  const left = daysBetween(todayISO, dueISO);
  if (left < 0) return 'overdue';
  if (left === 0) return 'due';
  if (left <= 3) return 'soon';
  return 'ok';
}

const URGENCY: Record<RefillStatus, number> = { overdue: 0, due: 1, soon: 2, none: 3, ok: 4 };

// 列表排序＝掃街當天的行動順序：該補的排最前，沒鋪過的排在「還早」前面
// （沒鋪過代表還沒談成，是待開發名單，比已鋪好的更需要跑）。
export function sortForField(
  merchants: ReadonlyArray<Merchant>,
  placements: ReadonlyArray<Placement>,
  todayISO: string,
): Merchant[] {
  return [...merchants].sort((a, b) => {
    const sa = refillStatus(todayISO, a.stance === '婉拒' ? null : dueOrNull(a.id, placements));
    const sb = refillStatus(todayISO, b.stance === '婉拒' ? null : dueOrNull(b.id, placements));
    if (URGENCY[sa] !== URGENCY[sb]) return URGENCY[sa] - URGENCY[sb];
    return a.name.localeCompare(b.name, 'zh-Hant');
  });
}

function dueOrNull(merchantId: string, placements: ReadonlyArray<Placement>): string | null {
  const p = latestPlacement(merchantId, placements);
  return p ? dueDateOf(p) : null;
}

// ── 公開頁 ─────────────────────────────────────────────────

// 只有明示同意、且非婉拒的商家能公開。這是唯一的出口，不要在別處自己篩。
export function publicMerchants(merchants: ReadonlyArray<Merchant>): Merchant[] {
  return merchants.filter((m) => m.publicConsent.granted && m.stance !== '婉拒');
}

export interface PublicEntry {
  name: string;
  category: string;
  address: string;
  hours: string;
  blurb: string;
  lat: number | null;
  lng: number | null;
}

// 公開頁只吐這幾個欄位——電話、內部備註、態度、對價說明一律不出去。
export function toPublicPayload(merchants: ReadonlyArray<Merchant>): PublicEntry[] {
  return publicMerchants(merchants).map((m) => ({
    name: m.name,
    category: m.category,
    address: m.address,
    hours: m.hours,
    blurb: m.blurb,
    lat: m.lat,
    lng: m.lng,
  }));
}

// ── Google Maps 輕連動（單向：我們是主場，只往外送）──────────────

// 一鍵導航：有座標走座標，沒座標退回地址查詢。
export function navUrl(m: Pick<Merchant, 'name' | 'address' | 'lat' | 'lng'>): string {
  const q = m.lat != null && m.lng != null ? `${m.lat},${m.lng}` : `${m.name} ${m.address}`.trim();
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 匯出 KML 給候選人自行匯入 Google「我的地圖」。
// 只帶基本資料與座標——拜訪紀錄、態度評價、電話不隨檔案外流。
export function toKML(title: string, merchants: ReadonlyArray<Merchant>): string {
  const marks = merchants
    .filter((m) => m.lat != null && m.lng != null)
    .map(
      (m) =>
        `    <Placemark>\n` +
        `      <name>${xmlEscape(m.name)}</name>\n` +
        `      <description>${xmlEscape([m.category, m.address, m.hours].filter(Boolean).join(' · '))}</description>\n` +
        `      <Point><coordinates>${m.lng},${m.lat},0</coordinates></Point>\n` +
        `    </Placemark>`,
    )
    .join('\n');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<kml xmlns="http://www.opengis.net/kml/2.2">\n` +
    `  <Document>\n    <name>${xmlEscape(title)}</name>\n${marks}\n  </Document>\n</kml>\n`
  );
}
