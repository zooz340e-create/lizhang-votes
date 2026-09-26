import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prOf, isHigh, position, type BaseFile } from './baseline.ts';

const lin = Array.from({ length: 101 }, (_, i) => i); // 百分位＝數值本身，好算

test('prOf：贏過全臺幾 % 的里，兩端夾在 0–100', () => {
  assert.equal(prOf(-5, lin), 0);
  assert.equal(prOf(0, lin), 0);
  assert.equal(prOf(50.5, lin), 51);
  assert.equal(prOf(999, lin), 100);
});

test('isHigh：等於中位數算高', () => {
  assert.equal(isHigh(50, lin), true);
  assert.equal(isHigh(49.9, lin), false);
});

const fake: BaseFile = {
  meta: { edu_source: '', edu_year: 114, inc_source: '', inc_year: 112, note: '' },
  pct: { edu: lin, inc: lin.map((x) => x * 10), aging: lin.map((x) => x * 5) },
  district: { 東區: { edu_p: 40, inc_med: 600, aging: 180 } },
  villages: {},
};

test('position：三軸齊全才給里型，代碼依高低組合', () => {
  const p = position(fake, '東區', { edu_p: 70, inc_med: 300 }, 400);
  assert.equal(p.archetype?.code, 'E+I-A+');
  assert.equal(p.archetype?.name, '知識型退休里');
  assert.deepEqual(p.axes.map((a) => a.district), [40, 600, 180]);
});

test('position：缺所得（調整里）就不推論里型，只回有值的軸', () => {
  const p = position(fake, '東區', { edu_p: 70 }, 400);
  assert.equal(p.archetype, null);
  assert.deepEqual(p.axes.map((a) => a.axis), ['edu', 'aging']);
});

test('position：無此區、無此里 → 空結果不炸', () => {
  const p = position(fake, '西區', undefined, undefined);
  assert.equal(p.axes.length, 0);
  assert.equal(p.archetype, null);
});

test('烘焙資料抽查：復中里、豐原里對得上財資中心與戶政司原始檔', () => {
  const hc = JSON.parse(readFileSync(new URL('../../public/data/base/10018.json', import.meta.url), 'utf8')) as BaseFile;
  assert.equal(hc.villages['東區|復中里'].edu_p, 55.3);
  assert.equal(hc.villages['東區|復中里'].inc_med, 690);
  const tc = JSON.parse(readFileSync(new URL('../../public/data/base/66000.json', import.meta.url), 'utf8')) as BaseFile;
  assert.equal(tc.villages['豐原區|豐原里'].inc_med, 420);
  // 8 種組合都有文案
  for (const e of [60, 10]) for (const i of [600, 100]) for (const a of [400, 100]) {
    assert.ok(position(fake, '東區', { edu_p: e, inc_med: i }, a).archetype?.name);
  }
});
