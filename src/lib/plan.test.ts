import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekSkeleton, observedLineRate, DEFAULT_LINE_RATE } from './plan.ts';

test('observedLineRate：樣本不足回退預設值，樣本夠用實測比例', () => {
  assert.equal(observedLineRate(30, 5), DEFAULT_LINE_RATE); // 接觸 < 50 樣本太小
  assert.equal(observedLineRate(320, 0), DEFAULT_LINE_RATE); // 沒 LINE 數據
  assert.equal(observedLineRate(320, 32), 0.1); // 32/320
});

test('weekSkeleton：平日兩場（站路口+市場）、週末兩場（掃街+宮廟）', () => {
  // 2026-08-24 是週一，生成 7 天 = 週一到週日
  const stops = weekSkeleton({
    fromISO: '2026-08-24',
    days: 7,
    existingDates: [],
    dailyLineQuota: 12,
    lineRate: 0.06,
  });
  assert.equal(stops.length, 14); // 每天 2 場 × 7 天
  const monday = stops.filter((s) => s.date === '2026-08-24');
  assert.deepEqual(monday.map((s) => s.type), ['站路口', '市場拜票']);
  const saturday = stops.filter((s) => s.date === '2026-08-29');
  assert.deepEqual(saturday.map((s) => s.type), ['掃街', '宮廟參拜']);
  // 每日配額 12 個 LINE ÷ 6% 轉換 = 200 接觸 ÷ 2 場 = 每場預計 100
  assert.ok(stops.every((s) => s.planned === 100 && !s.done));
});

test('weekSkeleton：已有行程的日期整天跳過', () => {
  const stops = weekSkeleton({
    fromISO: '2026-08-24',
    days: 3,
    existingDates: ['2026-08-25'],
    dailyLineQuota: 0,
    lineRate: 0.06,
  });
  assert.equal(stops.length, 4); // 3 天中跳過 1 天 → 2 天 × 2 場
  assert.ok(stops.every((s) => s.date !== '2026-08-25'));
  assert.ok(stops.every((s) => s.planned === 0)); // 無配額 → 預計 0，提示先設目標
});
