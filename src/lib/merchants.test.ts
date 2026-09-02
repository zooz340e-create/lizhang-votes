import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, daysBetween, retainUntilISO, cycleDaysOf,
  refillStatus, latestPlacement, dueDateOf, sortForField,
  publicMerchants, toPublicPayload, toKML, navUrl,
  grantConsent, NO_CONSENT, CONSENT_VERSION,
  type Merchant, type Placement,
} from './merchants.ts';

function m(over: Partial<Merchant> & { id: string; name: string }): Merchant {
  return {
    orgId: 'taifeng', category: '', address: '', lat: null, lng: null, hood: '',
    contactTitle: '', phone: '', hours: '', stance: '友善', blurb: '',
    publicConsent: NO_CONSENT, considerationNote: '', note: '',
    retainUntil: '2027-05-28', createdAt: '', updatedAt: '', updatedBy: '',
    ...over,
  };
}
function p(over: Partial<Placement> & { id: string; merchantId: string; placedAt: string }): Placement {
  return { orgId: 'taifeng', item: '衛生紙', qty: 5, refillDays: 14, by: '志工A', ...over };
}

test('日期工具：跨月、跨年、保存期限', () => {
  assert.equal(addDays('2026-09-02', 14), '2026-09-16');
  assert.equal(addDays('2026-12-28', 7), '2027-01-04'); // 跨年
  assert.equal(daysBetween('2026-09-02', '2026-09-16'), 14);
  assert.equal(daysBetween('2026-09-16', '2026-09-02'), -14);
  assert.equal(retainUntilISO('2026-11-28'), '2027-05-28'); // 投票日 +6 個月
});

test('補貨週期：小物有各自預設，未知品項回退 14 天', () => {
  assert.equal(cycleDaysOf('手機架'), 30);
  assert.equal(cycleDaysOf('名片/文宣'), 10);
  assert.equal(cycleDaysOf('沒見過的東西'), 14);
});

test('refillStatus：逾期/今天/三天內/還早/沒鋪過', () => {
  const today = '2026-09-02';
  assert.equal(refillStatus(today, '2026-08-30'), 'overdue');
  assert.equal(refillStatus(today, '2026-09-02'), 'due');
  assert.equal(refillStatus(today, '2026-09-05'), 'soon'); // 剛好 3 天
  assert.equal(refillStatus(today, '2026-09-06'), 'ok');
  assert.equal(refillStatus(today, null), 'none');
});

test('latestPlacement 取最晚放置的那筆，補貨日 = 放置日 + 週期', () => {
  const ps = [
    p({ id: 'p1', merchantId: 'a', placedAt: '2026-08-01' }),
    p({ id: 'p2', merchantId: 'a', placedAt: '2026-08-20', item: '手機架', refillDays: 30 }),
    p({ id: 'p3', merchantId: 'b', placedAt: '2026-08-25' }),
  ];
  const latest = latestPlacement('a', ps);
  assert.equal(latest?.id, 'p2');
  assert.equal(dueDateOf(latest!), '2026-09-19');
  assert.equal(latestPlacement('zzz', ps), null);
});

test('sortForField：該補的排最前，沒鋪過的排在還早的前面，婉拒沉底', () => {
  const today = '2026-09-02';
  const merchants = [
    m({ id: 'ok', name: '還早的店' }),        // 8/30 鋪 → 9/13 到期
    m({ id: 'new', name: '沒鋪過的店' }),      // 待開發
    m({ id: 'late', name: '逾期的店' }),       // 8/10 鋪 → 8/24 到期
    m({ id: 'no', name: '婉拒的店', stance: '婉拒' }),
  ];
  const ps = [
    p({ id: 'p1', merchantId: 'ok', placedAt: '2026-08-30' }),
    p({ id: 'p2', merchantId: 'late', placedAt: '2026-08-10' }),
    p({ id: 'p3', merchantId: 'no', placedAt: '2026-08-10' }), // 婉拒即使有紀錄也不催
  ];
  assert.deepEqual(
    sortForField(merchants, ps, today).map((x) => x.id),
    ['late', 'new', 'no', 'ok'],
  );
});

test('公開頁：預設不同意；只有明示同意且非婉拒才出得去', () => {
  const consented = grantConsent('候選人', '2026-09-02T10:00:00+08:00');
  assert.equal(consented.version, CONSENT_VERSION);
  const merchants = [
    m({ id: 'a', name: '同意的店', publicConsent: consented }),
    m({ id: 'b', name: '沒問過的店' }),
    m({ id: 'c', name: '同意但後來婉拒', stance: '婉拒', publicConsent: consented }),
  ];
  assert.deepEqual(publicMerchants(merchants).map((x) => x.id), ['a']);
});

test('公開資料只吐白名單欄位——電話、備註、態度、對價說明不外流', () => {
  const merchants = [
    m({
      id: 'a', name: '阿美早餐店', category: '早餐店', address: '台鳳里中山路 1 號',
      hours: '05:30–11:00', blurb: '古早味蛋餅', phone: '0912345678',
      note: '老闆娘的兒子在里辦', considerationNote: '待律師確認', stance: '友善',
      publicConsent: grantConsent('候選人', '2026-09-02T10:00:00+08:00'),
    }),
  ];
  const out = toPublicPayload(merchants);
  assert.deepEqual(Object.keys(out[0]).sort(), ['address', 'blurb', 'category', 'hours', 'lat', 'lng', 'name']);
  const json = JSON.stringify(out);
  for (const leak of ['0912345678', '里辦', '待律師確認', '友善']) {
    assert.equal(json.includes(leak), false, `公開資料外洩：${leak}`);
  }
});

test('navUrl：有座標走座標，沒座標退回店名＋地址', () => {
  assert.match(navUrl({ name: 'x', address: '', lat: 24.07, lng: 120.53 }), /destination=24\.07%2C120\.53/);
  assert.match(navUrl({ name: '阿美早餐店', address: '中山路1號', lat: null, lng: null }), /destination=%E9%98%BF/);
});

test('toKML：只帶有座標的點，特殊字元跳脫，經緯度順序為 lng,lat', () => {
  const kml = toKML('台鳳里 & 友善店家', [
    m({ id: 'a', name: '阿美<早餐>店', address: 'A & B 路', lat: 24.07, lng: 120.53 }),
    m({ id: 'b', name: '沒座標的店' }),
  ]);
  assert.match(kml, /<coordinates>120\.53,24\.07,0<\/coordinates>/); // KML 是 lng,lat
  assert.match(kml, /台鳳里 &amp; 友善店家/);
  assert.match(kml, /阿美&lt;早餐&gt;店/);
  assert.equal(kml.includes('沒座標的店'), false);
});
