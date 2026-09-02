import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  quote, nextTierHint, inventory, totalSpend, shopsCovered, requestText,
  type SupplyItem,
} from './supply.ts';

const tissue: SupplyItem = {
  item: '衛生紙', unit: '包', setupFee: 0, note: '',
  tiers: [{ minQty: 100, unitPrice: 8 }, { minQty: 500, unitPrice: 6 }, { minQty: 1000, unitPrice: 5 }],
};
const flyer: SupplyItem = {
  item: '名片/文宣', unit: '張', setupFee: 1200, note: '四色需開版',
  tiers: [{ minQty: 1000, unitPrice: 1.2 }, { minQty: 5000, unitPrice: 0.6 }],
};

test('quote：級距取「起訂量 ≤ 數量」中最大的一級，邊界值算進級距', () => {
  assert.equal(quote(tissue, 100).unitPrice, 8);
  assert.equal(quote(tissue, 499).unitPrice, 8);
  assert.equal(quote(tissue, 500).unitPrice, 6); // 邊界剛好進級
  assert.equal(quote(tissue, 5000).unitPrice, 5); // 超過最高級距沿用最高級
});

test('quote：低於最低級距會標記，但仍給得出參考價', () => {
  const q = quote(tissue, 50);
  assert.equal(q.belowMin, true);
  assert.equal(q.unitPrice, 8);
  assert.equal(q.total, 400);
  assert.equal(quote(tissue, 500).belowMin, false);
});

test('quote：版費是一次性，不隨數量乘', () => {
  const q = quote(flyer, 2000);
  assert.equal(q.subtotal, 2400);
  assert.equal(q.setupFee, 1200);
  assert.equal(q.total, 3600);
});

test('quote：沒有價目表或數量為 0 時回全 0，不擲錯', () => {
  assert.equal(quote({ ...tissue, tiers: [] }, 100).total, 0);
  assert.equal(quote(tissue, 0).total, 0);
});

test('nextTierHint：算出還差幾件，並抓出「買更多反而更便宜」', () => {
  const h = nextTierHint(tissue, 480)!;
  assert.equal(h.minQty, 500);
  assert.equal(h.needMore, 20);
  assert.equal(h.totalAtNextTier, 3000); // 500 × 6
  // 480 × 8 = 3840 > 3000 → 多買 20 包反而省 840 元
  assert.equal(h.cheaperOverall, true);
  // 已在最高級距就沒有下一級
  assert.equal(nextTierHint(tissue, 1200), null);
});

test('nextTierHint：級距折扣不夠深時，誠實說買更多就是比較貴', () => {
  const mild: SupplyItem = {
    item: '扇子', unit: '支', setupFee: 0, note: '',
    tiers: [{ minQty: 100, unitPrice: 10 }, { minQty: 500, unitPrice: 9.8 }],
  };
  const h = nextTierHint(mild, 480)!;
  assert.equal(h.needMore, 20);
  assert.equal(h.totalAtNextTier, 4900); // 500 × 9.8
  assert.equal(h.cheaperOverall, false); // 480 × 10 = 4800，多買 20 支要多付 100
});

test('inventory：買進減鋪出，鋪超過會出現負數（帳沒對齊的訊號）', () => {
  const stocks = inventory(
    [{ item: '衛生紙', qty: 500 }, { item: '衛生紙', qty: 200 }, { item: '手機架', qty: 100 }],
    [{ item: '衛生紙', qty: 120 }, { item: '扇子', qty: 30 }],
  );
  const byItem = Object.fromEntries(stocks.map((s) => [s.item, s]));
  assert.deepEqual(byItem['衛生紙'], { item: '衛生紙', bought: 700, placed: 120, left: 580 });
  assert.equal(byItem['手機架'].left, 100);
  assert.equal(byItem['扇子'].left, -30); // 鋪了沒買 → 負數，要讓人看見
});

test('totalSpend 與 shopsCovered', () => {
  assert.equal(totalSpend([{ total: 3600 }, { total: 400 }]), 4000);
  const placements = [
    { item: '衛生紙', qty: 10, merchantId: 'a' },
    { item: '衛生紙', qty: 20, merchantId: 'b' },
  ];
  assert.equal(shopsCovered(580, placements, '衛生紙'), 38); // 平均 15 包/家 → 38 家
  assert.equal(shopsCovered(580, [], '衛生紙'), null); // 沒樣本就不瞎猜
  assert.equal(shopsCovered(-5, placements, '衛生紙'), null);
});

test('requestText：含免責句，缺候選人姓名會標示', () => {
  const t = requestText({
    supplierName: '大同印刷', candidate: '', item: '名片/文宣', unit: '張',
    qty: 2000, q: quote(flyer, 2000), needBy: '2026-09-15', note: '',
  });
  assert.match(t, /〔請補：候選人〕/);
  assert.match(t, /實際報價與規格請以您這邊為準/);
  assert.match(t, /版費 1200 元/);
  assert.equal(t.includes('備註：'), false); // 空備註不佔行
});
