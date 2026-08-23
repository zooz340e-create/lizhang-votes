// 選戰行程規劃 — 純邏輯層（可單元測試，無 DOM 依賴）
//
// 「計畫/實績雙態」：行程卡先排（done=false，只有預計接觸），執行後打卡填實績
// （done=true）。估票漏斗與總帳只吃實績，計畫數字永不混入估票——預計 vs 實際
// 的落差本身就是候選人校準轉換率的第一手數據。
//
// 「週骨架生成」參考 Funliday「AI 行程草稿」的產品思路：對排程毫無頭緒的
// 素人候選人，先給一套可以直接改的常識骨架，好過面對空白頁。規則是寫死的
// 常識（平日尖峰站路口、黃昏進市場、週末掃街拜廟），不是 AI，也不假裝是。

export const STOP_TYPES = ['站路口', '掃街', '市場拜票', '宮廟參拜', '商家拜訪', '家訪', '活動/說明會', '其他'] as const;
export type StopType = (typeof STOP_TYPES)[number];

export interface Stop {
  id: string;
  date: string; // YYYY-MM-DD
  start: string; // HH:mm（可空字串）
  type: StopType;
  place: string;
  hood: string; // 鄰別/區塊（熱區聚合用）
  planned: number; // 預計接觸人次（計畫態的主數字）
  contacts: number; // 實際接觸人次（實績）
  line: number;
  pledges: number;
  volunteers: number;
  cost: number;
  rating: number; // 地點好感度 0–5
  note: string;
  done: boolean; // false=計畫中，true=已執行（數字為實績）
}

// 觀察到的「接觸 → 加LINE」轉換率；樣本太小就用保守預設值
export const DEFAULT_LINE_RATE = 0.06;
export function observedLineRate(contacts: number, line: number, minSample = 50): number {
  if (contacts < minSample || line <= 0) return DEFAULT_LINE_RATE;
  return line / contacts;
}

// 週骨架規則：每天兩場，時段與型態依平日/週末分流
const WEEKDAY_SLOTS: ReadonlyArray<Pick<Stop, 'start' | 'type' | 'place'>> = [
  { start: '07:00', type: '站路口', place: '上班尖峰路口（點編輯改地點）' },
  { start: '17:00', type: '市場拜票', place: '黃昏市場（點編輯改地點）' },
];
const WEEKEND_SLOTS: ReadonlyArray<Pick<Stop, 'start' | 'type' | 'place'>> = [
  { start: '09:00', type: '掃街', place: '掃街路段（點編輯改地點）' },
  { start: '16:00', type: '宮廟參拜', place: '宮廟/公園（點編輯改地點）' },
];

export interface SkeletonOptions {
  fromISO: string; // 起始日（含）
  days: number; // 生成天數
  existingDates: ReadonlyArray<string>; // 已有行程的日期，整天跳過不生成
  dailyLineQuota: number; // 每日需新增的加LINE數（缺口回推）
  lineRate: number; // 接觸→加LINE 轉換率
}

// 生成一週行程草稿（不含 id，由呼叫端補）
export function weekSkeleton(opts: SkeletonOptions): Array<Omit<Stop, 'id'>> {
  const { fromISO, days, existingDates, dailyLineQuota, lineRate } = opts;
  const skip = new Set(existingDates);
  const dailyContacts = lineRate > 0 ? Math.ceil(dailyLineQuota / lineRate) : 0;
  const out: Array<Omit<Stop, 'id'>> = [];
  const d = new Date(`${fromISO}T00:00:00`);
  for (let i = 0; i < days; i++) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!skip.has(iso)) {
      const dow = d.getDay();
      const slots = dow === 0 || dow === 6 ? WEEKEND_SLOTS : WEEKDAY_SLOTS;
      const perStop = Math.ceil(dailyContacts / slots.length);
      for (const s of slots) {
        out.push({
          date: iso,
          start: s.start,
          type: s.type,
          place: s.place,
          hood: '',
          planned: perStop,
          contacts: 0,
          line: 0,
          pledges: 0,
          volunteers: 0,
          cost: 0,
          rating: 0,
          note: '',
          done: false,
        });
      }
    }
    d.setDate(d.getDate() + 1);
  }
  return out;
}
