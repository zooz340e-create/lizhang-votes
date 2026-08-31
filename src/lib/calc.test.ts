import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  depositThreshold,
  winInsight,
  competition,
  consecutiveTerms,
  electionConfidence,
  commitmentFunnel,
  voteShares,
  DEFAULT_FUNNEL_TIERS,
  type Village,
  type ElectionResult,
  type CommitmentTier,
} from './calc.ts';

// 西寶里真實人口（戶政司 2020-11）
const xibao: Village = {
  region_code: '66000180008',
  village: '西寶里',
  pop_total: 5846,
  pop_eligible_est: 4627,
  history: [],
};

test('退保證金門檻 = 選舉人數 × 10% 進位（西寶里）；115 年保證金 3 萬', () => {
  const r = depositThreshold(xibao);
  assert.equal(r.votes, 463); // ceil(4627 * 0.1)，門檻公式（選罷法 §32）未變
  assert.equal(r.deposit, 30000); // 115 年中選會調降（111 年為 50000）
});

test('無歷史資料 → 信心 low、競爭分析資料不足', () => {
  assert.equal(electionConfidence(xibao), 'low');
  const c = competition(xibao);
  assert.equal(c.hasHistory, false);
  assert.equal(c.tier, '資料不足');
  const w = winInsight(xibao);
  assert.equal(w.historicalWins.length, 0);
  assert.ok(w.halfLine > 0, '仍給得出過半參考線');
  assert.equal(w.confidence, 'low');
});

test('兩人對決：當選目標接近上屆當選票，信心 medium', () => {
  const v: Village = {
    region_code: 'x',
    village: '測試A里',
    pop_total: 5000,
    pop_eligible_est: 4000,
    history: [
      {
        year: 2022,
        electorate: 4000,
        turnout: 0.7,
        valid_votes: 2700,
        candidates: [
          { name: '張三', votes: 1500, won: true },
          { name: '李四', votes: 1200, won: false },
        ],
      },
    ],
  };
  const w = winInsight(v);
  assert.equal(w.confidence, 'medium');
  assert.equal(w.lastWinner?.votes, 1500);
  assert.equal(w.halfLine, 1350); // ceil(2700/2)
  const c = competition(v);
  assert.equal(c.incumbentName, '張三');
  assert.equal(c.climbVotes, 1500); // 登頂要超過現任上屆的 1500 票
  assert.equal(c.consecutiveTerms, 1);
});

test('voteShares：三位候選人得票率加總 100%，由高至低排序', () => {
  const e: ElectionResult = {
    year: 2022,
    valid_votes: 3100,
    candidates: [
      { name: '乙', votes: 1000, won: false },
      { name: '甲', votes: 1300, won: true },
      { name: '丙', votes: 800, won: false },
    ],
  };
  const s = voteShares(e);
  assert.deepEqual(s.map((x) => x.name), ['甲', '乙', '丙']); // 高→低
  assert.equal(s[0].pct, 41.9); // 1300/3100
  assert.equal(s[1].pct, 32.3);
  assert.equal(s[2].pct, 25.8);
  const sum = s.reduce((t, x) => t + x.pct, 0);
  assert.ok(Math.abs(sum - 100) < 0.15, `加總應≈100，實得 ${sum}`); // 四捨五入誤差容忍
  // winInsight 的歷屆當選票也帶得票率
  const v: Village = { region_code: 'x', village: '測試%里', pop_eligible_est: 4000, history: [e] };
  assert.equal(winInsight(v).historicalWins[0].sharePct, 41.9);
});

test('多人混戰：3 名候選人', () => {
  const v: Village = {
    region_code: 'x',
    village: '測試B里',
    pop_total: 6000,
    pop_eligible_est: 4800,
    history: [
      {
        year: 2022,
        electorate: 4800,
        turnout: 0.68,
        valid_votes: 3100,
        candidates: [
          { name: '甲', votes: 1300, won: true },
          { name: '乙', votes: 1000, won: false },
          { name: '丙', votes: 800, won: false },
        ],
      },
    ],
  };
  const w = winInsight(v);
  assert.equal(w.lastWinner?.votes, 1300);
  assert.match(w.candidateNote, /混戰/);
});

test('長期同額競選：判為開放（機會），非極難', () => {
  const v: Village = {
    region_code: 'x',
    village: '測試C里',
    pop_total: 4000,
    pop_eligible_est: 3200,
    history: [
      {
        year: 2022,
        electorate: 3200,
        turnout: 0.6,
        valid_votes: 1900,
        uncontested: true,
        candidates: [{ name: '老王', votes: 1900, won: true }],
      },
    ],
  };
  const c = competition(v);
  assert.equal(c.tier, '大好機會'); // 長期沒人卡位 = 機會大
  assert.match(c.note, /機會|空/);
});

test('連任三屆同一人 → 高信心、連任屆數正確', () => {
  const mk = (year: number, winner: string): ElectionResult => ({
    year,
    electorate: 4000,
    turnout: 0.65,
    valid_votes: 2500,
    candidates: [
      { name: winner, votes: 1800, won: true },
      { name: '挑戰者', votes: 700, won: false },
    ],
  });
  const v: Village = {
    region_code: 'x',
    village: '測試D里',
    pop_total: 5000,
    pop_eligible_est: 4000,
    history: [mk(2022, '常勝里長'), mk(2018, '常勝里長'), mk(2014, '常勝里長')],
  };
  assert.equal(consecutiveTerms(v), 3);
  assert.equal(electionConfidence(v), 'high');
  assert.equal(competition(v).tier, '硬仗'); // 大比數連贏 = 機會指數低 = 硬仗
});

test('承諾階梯漏斗：全 0 人數 → 估票區間為 0', () => {
  const tiers: CommitmentTier[] = DEFAULT_FUNNEL_TIERS.map((t) => ({ ...t, count: 0 }));
  const r = commitmentFunnel(tiers);
  assert.equal(r.low, 0);
  assert.equal(r.high, 0);
  assert.equal(r.totalContacts, 0);
});

test('承諾階梯漏斗：區間下限=各階人數×下限轉換率加總，上限同理', () => {
  const tiers: CommitmentTier[] = [
    { key: 'reach', label: '', count: 1000, rateLow: 0.01, rateHigh: 0.05 },
    { key: 'light', label: '', count: 200, rateLow: 0.1, rateHigh: 0.2 },
    { key: 'mid', label: '', count: 50, rateLow: 0.2, rateHigh: 0.4 },
    { key: 'heavy', label: '', count: 20, rateLow: 0.7, rateHigh: 0.9 },
  ];
  const r = commitmentFunnel(tiers);
  // low = 1000*.01 + 200*.1 + 50*.2 + 20*.7 = 10+20+10+14 = 54
  assert.equal(r.low, 54);
  // high = 1000*.05 + 200*.2 + 50*.4 + 20*.9 = 50+40+20+18 = 128
  assert.equal(r.high, 128);
  assert.equal(r.totalContacts, 1270);
});
