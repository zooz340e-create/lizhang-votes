// 邀約信 — 純邏輯層（模板 + 變數替換，可單元測試）
//
// 為什麼是模板不是 AI 生成：
//  1. 沒有後端，呼叫模型要金鑰要付費，會破壞本專案的免後端鐵律。
//  2. 更重要的是——AI 寫的信一看就知道是 AI 寫的。里長選舉是極度看人情的場域，
//     一封「太完整」的信反而扣分。模板給骨架，候選人改過一次就變成他的話。
//
// 素材來源是品牌模組五步流程的產出（三個特質、主標語、10 秒自介）。
// 那套流程原本只有一個落點（帶去路口用講的），這裡是它的第二個出口：換成書面。

export const LETTER_KINDS = ['LINE 訊息', '紙本遞出', '活動邀請'] as const;
export type LetterKind = (typeof LETTER_KINDS)[number];

// 品牌模組的產出落點。三個特質、一句主標，就是信裡的骨頭。
export interface CandidateProfile {
  name: string; // 候選人姓名
  title: string; // 職稱，例：台鳳里長候選人
  traits: string[]; // 三個特質（品牌模組步驟 02）
  slogan: string; // 主標語（品牌模組步驟 03）
  contact: string; // 聯絡方式：LINE ID 或手機
  eventInfo: string; // 活動資訊（選前之夜用）
  eventUrl: string; // 報名連結
}

export const EMPTY_PROFILE: CandidateProfile = {
  name: '', title: '', traits: [], slogan: '', contact: '', eventInfo: '', eventUrl: '',
};

export interface LetterTemplate {
  id: string;
  orgId: string;
  name: string;
  kind: LetterKind;
  body: string;
  builtin: boolean; // 內建模板不可刪，改了就另存成自己的
}

// 產生的信會寫進商家的往來紀錄——下次去之前看得到上次給過什麼。
export interface LetterRecord {
  id: string;
  orgId: string;
  merchantId: string;
  templateName: string;
  kind: LetterKind;
  body: string;
  at: string;
  by: string;
}

export type LetterVars = Record<string, string>;

// 空值刻意渲染成〔請補：X〕而不是靜靜留白——
// 「親愛的 　您好」這種信送出去比沒送更糟。
const FILL = (k: string) => `〔請補：${k}〕`;
const UNKNOWN = (k: string) => `〔未知變數：${k}〕`;

export function renderTemplate(body: string, vars: LetterVars): string {
  return body.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key: string) => {
    if (!(key in vars)) return UNKNOWN(key);
    const v = vars[key];
    return v.trim() === '' ? FILL(key) : v;
  });
}

// 送出前的檢查清單：這封信還缺哪些東西。
export function missingVars(body: string, vars: LetterVars): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
    const key = m[1];
    if (!(key in vars) || vars[key].trim() === '') out.add(key);
  }
  return [...out];
}

export interface VarInput {
  merchantName: string;
  contactTitle: string; // 負責人稱謂
  category: string;
  hood: string;
  orgLabel: string; // 里名
  profile: CandidateProfile;
  lastItem: string; // 最近鋪的小物
  lastVisit: string; // 上次互動摘要
  todayISO: string;
}

export function buildVars(i: VarInput): LetterVars {
  return {
    店名: i.merchantName,
    稱謂: i.contactTitle.trim() || '老闆', // 沒問到名字時的安全稱呼
    類型: i.category,
    鄰別: i.hood,
    里名: i.orgLabel,
    候選人: i.profile.name,
    職稱: i.profile.title,
    主標語: i.profile.slogan,
    特質: i.profile.traits.filter(Boolean).join('、'),
    聯絡方式: i.profile.contact,
    小物: i.lastItem.trim() || '衛生紙',
    上次互動: i.lastVisit,
    活動資訊: i.profile.eventInfo,
    報名連結: i.profile.eventUrl,
    今天: i.todayISO,
  };
}

export const VAR_NAMES = [
  '店名', '稱謂', '類型', '鄰別', '里名', '候選人', '職稱', '主標語',
  '特質', '聯絡方式', '小物', '上次互動', '活動資訊', '報名連結', '今天',
] as const;

// ── 三個內建模板 ─────────────────────────────────────────────
// 語氣刻意寫得樸素、短、留退路（「不方便也沒關係」）。素人候選人最容易犯的錯
// 是把信寫得太像文宣；在騎樓下遞出去的紙，講人話才有人看。

export function builtinTemplates(orgId: string): LetterTemplate[] {
  return [
    {
      id: 'builtin-first-visit',
      orgId,
      name: '初次拜訪',
      kind: 'LINE 訊息',
      builtin: true,
      body: [
        '{{稱謂}}您好，我是{{候選人}}，這次要選{{里名}}里長。',
        '',
        '剛剛經過您店裡，冒昧打擾。我想做的事很簡單：{{主標語}}',
        '',
        '不耽誤您做生意，只想留個聯絡方式。里內有什麼事要反映，隨時找我：{{聯絡方式}}',
        '',
        '謝謝您。',
      ].join('\n'),
    },
    {
      id: 'builtin-placement',
      orgId,
      name: '請託放小物',
      kind: '紙本遞出',
      builtin: true,
      body: [
        '{{稱謂}} 您好：',
        '',
        '我是{{候選人}}，{{職稱}}。{{主標語}}',
        '',
        '想跟您商量一件小事：能不能在店裡放一些{{小物}}給客人取用？上面有我的聯絡方式，客人有需要也方便。東西我固定回來補，不會給您添麻煩。',
        '',
        '如果您願意，我也會把貴店放進「{{里名}}友善店家」，讓更多人知道這裡。',
        '',
        '當然，不方便也完全沒關係，我還是會常來。',
        '',
        '{{候選人}} 敬上',
        '{{聯絡方式}}',
        '{{今天}}',
      ].join('\n'),
    },
    {
      id: 'builtin-event',
      orgId,
      name: '活動邀請',
      kind: '活動邀請',
      builtin: true,
      body: [
        '{{稱謂}}您好，我是{{候選人}}。',
        '',
        '{{里名}}的活動想邀請您和家人一起來。免費入場，不收任何款項。',
        '',
        '{{活動資訊}}',
        '',
        '報名：{{報名連結}}',
        '',
        '一直很謝謝您這段時間的照顧。',
        '{{候選人}} 敬上',
      ].join('\n'),
    },
  ];
}
