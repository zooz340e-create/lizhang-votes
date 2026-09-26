// 基準定位 — 把三個數字翻成「這個里的痛點推論」
//
// 三軸：大專以上比例（edu）、每戶綜合所得中位數（inc）、老化指數（aging）
// 每軸以「全臺里級中位數」切高／低 → 2³＝8 種里型，每型一段推論文案。
// 資料由 etl/bake_baseline.mjs 烘焙；純函式、無瀏覽器依賴，node --test 可直接測。

export interface BaseEntry {
  edu_p?: number; // 大專以上 %（15 歲以上）
  inc_med?: number; // 每戶綜合所得中位數（千元）
  inc_q1?: number;
  inc_q3?: number;
  inc_n?: number; // 納稅單位（戶）
}
export interface BaseFile {
  meta: { edu_source: string; edu_year: number; inc_source: string; inc_year: number; note: string };
  pct: { edu: number[]; inc: number[]; aging: number[] }; // 全臺里級 0..100 百分位，共 101 點
  district: Record<string, { edu_p: number | null; inc_med: number | null; aging: number | null }>;
  villages: Record<string, BaseEntry>; // key = `${district}|${village}`
}

export type Axis = 'edu' | 'inc' | 'aging';

// 在全臺里之中的百分等級：「贏過全臺幾 % 的里」（0–100）
export function prOf(value: number, pct: number[]): number {
  return Math.min(100, pct.filter((p) => p < value).length);
}

// 高於等於全臺中位數＝高
export const isHigh = (value: number, pct: number[]) => value >= pct[50];

export interface Archetype {
  code: string; // 例：E+I-A+
  name: string;
  portrait: string; // 一句話輪廓
  pains: string[]; // 痛點推論
  forCandidate: string; // 給候選人的打法
  forVoter: string; // 給選民：可以問候選人的問題
}

// 文案草稿（2026-09-26 起草，待使用者審定）——全部是統計推論，不是民調結果
const ARCHETYPES: Record<string, Omit<Archetype, 'code'>> = {
  'E+I+A-': {
    name: '都會雙薪家庭里',
    portrait: '學歷高、收入高、人口年輕——多半是上班族小家庭。',
    pains: ['托育與學區', '通勤、停車與交通安全', '下班後才有空，社區事務沒時間參與'],
    forCandidate: '他們白天不在家，掃街效果差；要在晚間、週末與線上講具體方案和數字。',
    forVoter: '問候選人：托育、停車、通學路安全，有沒有具體做法和時程？',
  },
  'E+I+A+': {
    name: '資深專業住宅里',
    portrait: '學歷高、收入高、長輩多——退休專業人士與資深屋主集中。',
    pains: ['老屋更新、電梯與無障礙', '就醫方便與緊急救護', '治安與環境品質'],
    forCandidate: '重視程序與資訊透明；用說明會、書面政見與公開帳目建立信任。',
    forVoter: '問候選人：老屋、無障礙改善怎麼推？里的經費怎麼公開？',
  },
  'E+I-A-': {
    name: '青年起步里',
    portrait: '學歷高、人口年輕，但收入還沒跟上——學生、租屋族、剛出社會的人多。',
    pains: ['租屋與生活成本', '公共空間與夜間照明', '流動率高、對里務陌生'],
    forCandidate: '用 IG／Threads 觸及，主打生活議題；提醒戶籍在此的年輕人回來投票。',
    forVoter: '問候選人：租屋族、年輕人能從里辦公處得到什麼？',
  },
  'E+I-A+': {
    name: '知識型退休里',
    portrait: '學歷高、長輩多，申報所得偏低——常見於退休公教族群（退休金不全計入綜所）。',
    pains: ['健康、陪伴與社區照顧', '就醫交通', '長輩的數位落差'],
    forCandidate: '資訊能力好、在意誠信；講座、共餐與書面資料比口號有用。',
    forVoter: '問候選人：長輩照顧據點、共餐、就醫接駁有沒有規劃？',
  },
  'E-I+A-': {
    name: '在地產業家庭里',
    portrait: '收入高、人口年輕，學歷不特別高——自營商、產業與工廠周邊的家庭多。',
    pains: ['道路、交通與治安', '托育與孩子的活動空間', '產業環境（噪音、貨車、排水）'],
    forCandidate: '人際網絡決定口碑；經營商家、工廠、宮廟與家長群組。',
    forVoter: '問候選人：道路、排水與治安的具體改善清單？',
  },
  'E-I+A+': {
    name: '在地老家族里',
    portrait: '收入高、長輩多，學歷不特別高——地主、老店家與在地家族為主。',
    pains: ['土地、道路與排水', '廟務與傳統活動', '長輩照顧'],
    forCandidate: '人情網絡決定選票；拜訪地方頭人、宮廟，出席婚喪喜慶。',
    forVoter: '問候選人：地方建設的優先順序怎麼排？怎麼跟大家說明？',
  },
  'E-I-A-': {
    name: '勞動家庭里',
    portrait: '人口年輕，但學歷與收入都偏低——勞動家庭、工時長的上班族多。',
    pains: ['生活開銷與補助資訊不對稱', '托育、課後照顧', '工時長，沒空處理公共事務'],
    forCandidate: '在早上與下班時段的路口、市場出現；主動幫忙申請補助比政見有感。',
    forVoter: '問候選人：補助、托育資源，里辦公處會不會主動幫我們申請？',
  },
  'E-I-A+': {
    name: '高齡守護里',
    portrait: '長輩多，學歷與收入都偏低——高齡化的老社區或偏鄉。',
    pains: ['長照與獨居長輩', '看病交通與接駁', '年輕人外流、社區活力下降'],
    forCandidate: '挨家挨戶、共餐與長照據點是主戰場；面對面比網路重要。',
    forVoter: '問候選人：獨居長輩誰來關心？就醫接駁怎麼安排？',
  },
};

export interface Positioning {
  axes: { axis: Axis; value: number; pr: number; high: boolean; district: number | null }[];
  archetype: Archetype | null; // 三軸缺一就不推論
}

export function position(
  base: BaseFile,
  district: string,
  entry: BaseEntry | undefined,
  aging: number | undefined,
): Positioning {
  const dist = base.district[district];
  const vals: [Axis, number | undefined, number | null][] = [
    ['edu', entry?.edu_p, dist?.edu_p ?? null],
    ['inc', entry?.inc_med, dist?.inc_med ?? null],
    ['aging', aging, dist?.aging ?? null],
  ];
  const axes = vals
    .filter((v): v is [Axis, number, number | null] => v[1] !== undefined)
    .map(([axis, value, d]) => ({ axis, value, pr: prOf(value, base.pct[axis]), high: isHigh(value, base.pct[axis]), district: d }));
  let archetype: Archetype | null = null;
  if (axes.length === 3) {
    const [e, i, a] = axes;
    const code = `E${e.high ? '+' : '-'}I${i.high ? '+' : '-'}A${a.high ? '+' : '-'}`;
    archetype = { code, ...ARCHETYPES[code] };
  }
  return { axes, archetype };
}
