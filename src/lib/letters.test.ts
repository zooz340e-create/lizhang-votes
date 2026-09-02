import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderTemplate, missingVars, buildVars, builtinTemplates, EMPTY_PROFILE,
  type CandidateProfile,
} from './letters.ts';

const profile: CandidateProfile = {
  name: '林昱誠', title: '台鳳里長候選人',
  traits: ['跑最勤', '修排水', '會用手機'],
  slogan: '排水溝通了，再談別的。',
  contact: 'LINE @449kyids', eventInfo: '11/28 19:00 台鳳里活動中心', eventUrl: 'https://example.tw/eve',
};

function vars(over: Partial<Parameters<typeof buildVars>[0]> = {}) {
  return buildVars({
    merchantName: '阿美早餐店', contactTitle: '陳老闆', category: '早餐店', hood: '第5鄰',
    orgLabel: '台鳳里', profile, lastItem: '衛生紙', lastVisit: '2026-08-20 補貨',
    todayISO: '2026-09-02', ...over,
  });
}

test('renderTemplate：變數替換，空白處理，未知變數標示', () => {
  const v = vars();
  assert.equal(renderTemplate('{{稱謂}}您好，我是{{候選人}}。', v), '陳老闆您好，我是林昱誠。');
  assert.equal(renderTemplate('{{ 店名 }}', v), '阿美早餐店'); // 容忍空白
  assert.equal(renderTemplate('{{里長芳名}}', v), '〔未知變數：里長芳名〕');
});

test('空值渲染成〔請補〕而不是靜靜留白', () => {
  const v = buildVars({
    merchantName: '某店', contactTitle: '', category: '', hood: '', orgLabel: '台鳳里',
    profile: EMPTY_PROFILE, lastItem: '', lastVisit: '', todayISO: '2026-09-02',
  });
  assert.equal(renderTemplate('我是{{候選人}}', v), '我是〔請補：候選人〕');
  assert.equal(renderTemplate('{{稱謂}}', v), '老闆'); // 沒問到名字時退回安全稱呼
  assert.equal(renderTemplate('{{小物}}', v), '衛生紙'); // 沒鋪過時的預設品項
});

test('missingVars：列出送出前還缺什麼，重複只算一次', () => {
  const v = buildVars({
    merchantName: '某店', contactTitle: '', category: '', hood: '', orgLabel: '台鳳里',
    profile: { ...EMPTY_PROFILE, name: '林昱誠' }, lastItem: '', lastVisit: '', todayISO: '2026-09-02',
  });
  const body = '{{候選人}}{{主標語}}{{聯絡方式}}{{主標語}}{{沒這個}}';
  assert.deepEqual(missingVars(body, v).sort(), ['主標語', '沒這個', '聯絡方式']);
  assert.deepEqual(missingVars('{{候選人}}', v), []);
});

test('內建三個模板，填滿檔案後不留任何〔請補〕', () => {
  const ts = builtinTemplates('taifeng');
  assert.deepEqual(ts.map((t) => t.name), ['初次拜訪', '請託放小物', '活動邀請']);
  assert.equal(ts.every((t) => t.builtin), true);
  const v = vars();
  for (const t of ts) {
    const out = renderTemplate(t.body, v);
    assert.equal(out.includes('〔請補'), false, `${t.name} 有未填欄位`);
    assert.equal(out.includes('〔未知變數'), false, `${t.name} 用了不存在的變數`);
    assert.equal(out.includes('{{'), false, `${t.name} 有沒替換到的變數`);
  }
});

test('請託放小物模板必須留退路——不勉強商家的那句話不能刪', () => {
  const t = builtinTemplates('x').find((x) => x.name === '請託放小物')!;
  assert.match(t.body, /不方便也完全沒關係/);
  assert.match(t.body, /友善店家/); // 互惠：曝光是交換條件，要寫進信裡
});
