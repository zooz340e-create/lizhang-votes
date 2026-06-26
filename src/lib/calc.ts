// 里長票數計算機 — 核心計算邏輯（純函式，無副作用，可單元測試）
//
// 法律依據（公職人員選舉罷免法）：
//  - 村里長候選人保證金 NT$5,000（由中選會每次選舉公告，歷年為 5,000）
//  - 保證金發還門檻：得票數 ≥ 選舉人數 ÷ 應選名額(里長=1) × 10% = 選舉人數 × 10%
//  - 當選：相對多數最高票
// ⚠️ 當選票數與競爭分析為「估算」，非保證；保證金門檻為接近官方的法定試算。

export const DEPOSIT_NTD = 5000; // 里長保證金（元）
export const DEPOSIT_RATE = 0.1; // 退還門檻比例：選舉人數 × 10%
export const DEFAULT_TURNOUT = 0.65; // 無歷史資料時的預設里長投票率
export const VALID_VOTE_RATIO = 0.97; // 有效票約占投票數比例（扣廢票）

export interface Candidate {
  name: string;
  votes: number;
  won: boolean;
  party?: string; // 政黨短代碼：KMT/DPP/TPP/NPP/PFP/IND…
  birthYear?: number; // 出生年（西元）
}

// 下次里長選舉年（2022 + 4），用來算現任年齡，避免依賴系統時間
export const NEXT_ELECTION_YEAR = 2026;

export interface ElectionResult {
  year: number;
  term?: number;
  electorate?: number; // 該屆官方選舉人數
  turnout?: number; // 投票率 0-1
  valid_votes?: number;
  candidates: Candidate[];
  uncontested?: boolean; // 同額競選（候選人數 = 應選名額）
}

export interface Village {
  region_code: string;
  village: string;
  pop_total: number;
  pop_eligible_est: number; // 20 歲以上人口（選舉人數近似值）
  history?: ElectionResult[]; // 由新到舊排序
}

export type Confidence = 'high' | 'medium' | 'low';
export type OppTier = '大好機會' | '有機會' | '拚拚看' | '硬仗' | '資料不足';

// ── 小工具 ───────────────────────────────────────────────
function latestElection(v: Village): ElectionResult | undefined {
  return v.history && v.history.length > 0 ? v.history[0] : undefined;
}

function winnerName(e: ElectionResult): string | undefined {
  const w = e.candidates.find((c) => c.won);
  if (w) return w.name;
  if (e.candidates.length === 0) return undefined;
  return [...e.candidates].sort((a, b) => b.votes - a.votes)[0]?.name;
}

function topTwoVotes(e: ElectionResult): [number, number] {
  const sorted = [...e.candidates].map((c) => c.votes).sort((a, b) => b - a);
  return [sorted[0] ?? 0, sorted[1] ?? 0];
}

// 連任屆數：從最近一屆往回數，當選人姓名相同的連續屆數
export function consecutiveTerms(v: Village): number {
  const h = v.history;
  if (!h || h.length === 0) return 0;
  const name = winnerName(h[0]);
  if (!name) return 0;
  let n = 0;
  for (const e of h) {
    if (winnerName(e) === name) n++;
    else break;
  }
  return n;
}

// ── 1. 退保證金門檻 ──────────────────────────────────────
export interface DepositResult {
  votes: number; // 達標所需票數
  electorate: number; // 採用的選舉人數
  deposit: number; // 保證金金額
  isEstimate: boolean; // 是否為推估（無官方選舉人數時為 true）
}

export function depositThreshold(v: Village): DepositResult {
  // 以最新人口推估的選舉人數為準（「如果現在就選」）
  const electorate = v.pop_eligible_est;
  return {
    votes: Math.ceil(electorate * DEPOSIT_RATE),
    electorate,
    deposit: DEPOSIT_NTD,
    isEstimate: true,
  };
}

// ── 2. 當選票數：用真實歷史 + 過半參考線（不做假裝很準的單一預測）──
//   回測顯示里長選舉變數太大（關鍵是「幾人參選」），單一預測數字 2022 只命中 2/9，
//   故改以「近三屆實際當選票」為標竿，輔以過半參考線，並說明參選人數的影響。
export interface HistWin {
  year: number;
  votes: number;
  name: string;
  uncontested: boolean;
  party?: string;
}

export interface WinInsight {
  historicalWins: HistWin[]; // 近屆實際當選票（新→舊）
  lastWinner?: HistWin; // 上屆當選人
  histMinWin?: number; // 近屆當選票最低
  histMaxWin?: number; // 近屆當選票最高
  halfLine: number; // 過半參考線（兩人對決要拿的票）= ceil(預估有效票/2)
  expectedValidVotes: number; // 預估有效票
  turnout: number;
  confidence: Confidence;
  candidateNote: string; // 「看幾人參選」說明
}

export function winInsight(v: Village): WinInsight {
  const last = latestElection(v);
  const electorate = last?.electorate ?? v.pop_eligible_est;
  const turnout = last?.turnout ?? DEFAULT_TURNOUT;
  const expectedValidVotes = last?.valid_votes ?? Math.round(electorate * turnout * VALID_VOTE_RATIO);
  const halfLine = Math.ceil(expectedValidVotes / 2);

  const historicalWins: HistWin[] = (v.history ?? [])
    .map((e): HistWin | undefined => {
      const w = e.candidates.find((c) => c.won) ?? [...e.candidates].sort((a, b) => b.votes - a.votes)[0];
      return w
        ? { year: e.year, votes: w.votes, name: w.name, uncontested: !!e.uncontested, party: w.party }
        : undefined;
    })
    .filter((x): x is HistWin => !!x);

  const voteNums = historicalWins.map((h) => h.votes);
  const histMinWin = voteNums.length ? Math.min(...voteNums) : undefined;
  const histMaxWin = voteNums.length ? Math.max(...voteNums) : undefined;

  let candidateNote: string;
  if (!last) {
    candidateNote = '查無歷屆得票資料，僅能以人口推估；實際當選門檻要看那年有幾人參選。';
  } else {
    const n = last.candidates.length;
    if (last.uncontested) {
      candidateNote = `上屆為同額競選（只有現任 1 人）。一旦有人挑戰，當選門檻大約落在過半（約 ${halfLine.toLocaleString('zh-TW')} 票）附近。`;
    } else if (n >= 3) {
      candidateNote = `上屆 ${n} 人混戰，票被分散，當選票自然偏低；參選人越少，門檻越高。`;
    } else {
      candidateNote = `上屆為 ${n} 人對決，需過半；若有第三人參選分票，當選門檻會下降。`;
    }
  }

  return {
    historicalWins,
    lastWinner: historicalWins[0],
    histMinWin,
    histMaxWin,
    halfLine,
    expectedValidVotes,
    turnout,
    confidence: electionConfidence(v),
    candidateNote,
  };
}

export function electionConfidence(v: Village): Confidence {
  const n = v.history?.length ?? 0;
  if (n >= 2) return 'high';
  if (n === 1) return 'medium';
  return 'low';
}

// ── 3. 參選機會分析（評分制）──────────────────────────────
// 一律「正向講你的機會」，不對真人下負評（避免炎上）：分數高=你機會大；
// 分數低=現任人氣穩固（誇對方），不講「弱/崩/鬆」。
export interface OppFactor {
  label: string; // 正向中性敘述
  points: number; // 對機會指數的加減分
}
export interface Competition {
  hasHistory: boolean;
  incumbentName?: string;
  incumbentVotes?: number;
  incumbentAge?: number; // 現任約略年齡（下次選舉年推算）
  consecutiveTerms: number;
  score: number; // 參選機會指數 0–100
  tier: OppTier;
  factors: OppFactor[]; // 機會指數的加減分明細（畫面逐條顯示）
  climbVotes: number; // 登頂（當選）大約要幾票
  climbBasis: string;
  rivalName?: string;
  rivalVotes?: number;
  note: string; // 一句結論（正向）
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function tierOf(score: number): OppTier {
  if (score >= 70) return '大好機會';
  if (score >= 50) return '有機會';
  if (score >= 30) return '拚拚看';
  return '硬仗';
}

export function competition(v: Village): Competition {
  const last = latestElection(v);
  if (!last) {
    return {
      hasHistory: false,
      consecutiveTerms: 0,
      score: 0,
      tier: '資料不足',
      factors: [],
      climbVotes: 0,
      climbBasis: '無資料',
      note: '這個里還沒補上歷屆里長得票資料，機會指數先補充中（僅供參考）。',
    };
  }

  const terms = consecutiveTerms(v);
  const [first, second] = topTwoVotes(last);
  const lastValid = last.valid_votes ?? last.candidates.reduce((s, c) => s + c.votes, 0);
  const lastMargin = first - second;
  const lastMarginPct = lastValid > 0 ? lastMargin / lastValid : 0;
  const halfLine = Math.ceil(lastValid / 2);
  const turnout = last.turnout ?? DEFAULT_TURNOUT;
  const name = winnerName(last);

  // 上屆第二名 = 另一位人氣參選人（這屆可能再戰、跟你分票）
  const sortedLast = [...last.candidates].sort((a, b) => b.votes - a.votes);
  const runnerUp = !last.uncontested && sortedLast.length > 1 ? sortedLast[1] : undefined;
  const rivalShare = runnerUp && lastValid > 0 ? runnerUp.votes / lastValid : 0;

  // 現任實戰最佳一屆（有對手且當選人=現任）
  let best: { win: number } | undefined;
  for (const e of v.history ?? []) {
    if (e.uncontested || e.candidates.length <= 1 || winnerName(e) !== name) continue;
    const a = topTwoVotes(e)[0];
    if (!best || a > best.win) best = { win: a };
  }
  const everContested = best !== undefined;

  // 現任連任這幾屆的當選票（舊→新），算走勢
  const incWins = (v.history ?? [])
    .filter((e) => winnerName(e) === name)
    .slice(0, terms)
    .map((e) => topTwoVotes(e)[0])
    .reverse();

  // 現任年齡（下次選舉年推算）
  const incCand = last.candidates.find((c) => c.won) ?? sortedLast[0];
  const incumbentAge = incCand?.birthYear ? NEXT_ELECTION_YEAR - incCand.birthYear : undefined;

  // ── 機會指數：base 50 + 各因子（正向敘述）──
  const factors: OppFactor[] = [];
  const add = (label: string, pts: number) => {
    if (Math.round(pts) !== 0) factors.push({ label, points: Math.round(pts) });
  };

  // f1 上屆競爭緊度（越接近，你越有空間）
  if (!last.uncontested) {
    const p = clamp(30 - (lastMarginPct / 0.25) * 45, -22, 30);
    add(p >= 0 ? `上屆票數接近（贏 ${Math.round(lastMarginPct * 100)}%）` : `上屆領先較多（贏 ${Math.round(lastMarginPct * 100)}%）`, p);
  }
  // f2 走勢（新人空間）
  if (incWins.length >= 2) {
    const trend = (incWins[incWins.length - 1] - incWins[0]) / incWins[0];
    const p = clamp(-trend * 40, -12, 18);
    if (p > 0) add('新人空間擴大中', p);
    else if (p < 0) add('現任人氣上升中', p);
  }
  // f3 動員空間
  {
    const p = clamp(((0.68 - turnout) / 0.68) * 18, -8, 14);
    if (p >= 0) add(`還有不少票沒被動員（投票率 ${Math.round(turnout * 100)}%）`, p);
    else add(`票源已充分動員（投票率 ${Math.round(turnout * 100)}%）`, p);
  }
  // f4 舞台型態
  if (last.uncontested && !everContested) add('舞台長期空著、沒人卡位', 20);
  else if (last.uncontested) add('近期無人挑戰', 6);
  // f5 現任年資（可能交棒）
  if (incumbentAge) {
    const p = clamp(((incumbentAge - 62) / 13) * 16, 0, 16);
    if (p >= 4) add(`現任資深（約 ${incumbentAge} 歲），可能交棒`, p);
  }
  // f6 另一位人氣參選人在場（已有強棒卡位＝對新人來說要三方搶，機會大打折）
  if (runnerUp && rivalShare >= 0.25) {
    const p = -clamp(((rivalShare - 0.25) / 0.15) * 35, 0, 35);
    add(`已有人氣參選人 ${runnerUp.name} 卡位（上屆得票率 ${Math.round(rivalShare * 100)}%）`, p);
  }

  const score = clamp(Math.round(50 + factors.reduce((s, f) => s + f.points, 0)), 0, 100);
  const tier = tierOf(score);

  // 登頂（當選）大約要幾票——用現任最近實力當基準
  let climbVotes: number;
  let climbBasis: string;
  if (!last.uncontested) {
    climbVotes = Math.max(halfLine, first);
    climbBasis = `要超過現任上屆的 ${nf(first)} 票`;
  } else if (everContested) {
    climbVotes = Math.max(halfLine, best!.win);
    climbBasis = `對齊現任實戰拿過的 ${nf(best!.win)} 票`;
  } else {
    climbVotes = halfLine;
    climbBasis = `兩人對決過半（約 ${nf(halfLine)} 票）`;
  }

  // 結論（正向 / 不貶低真人）
  const note =
    tier === '大好機會'
      ? last.uncontested && !everContested
        ? '這個位子一直沒人卡位、舞台是空的，新人空間很大。'
        : '上屆競爭活躍、票數接近，新人很有揮灑空間。'
      : tier === '有機會'
        ? '現任有一定基礎，但只要勤跑、紮實經營，仍然很有機會。'
        : tier === '拚拚看'
          ? '現任經營深、人氣不錯，要登頂得下功夫、衝高基本盤。'
          : '現任人氣穩固、鐵票扎實，這是一場硬仗，得長期布局。';

  return {
    hasHistory: true,
    incumbentName: name,
    incumbentVotes: first,
    incumbentAge,
    consecutiveTerms: terms,
    score,
    tier,
    factors,
    climbVotes,
    climbBasis,
    rivalName: runnerUp?.name,
    rivalVotes: runnerUp?.votes,
    note,
  };
}

function nf(n: number): string {
  return n.toLocaleString('zh-TW');
}
