// 邀約信 — 介面層
//
// 素材來自品牌模組五步流程（三個特質 + 主標語）。那套流程原本只有一個落點
// 「帶去路口用講的」，這裡是它的第二個出口：換成書面，解決素人候選人最怕的
// 「推門進去要說什麼」。
//
// 產生的信會寫進商家的往來紀錄——下次去之前看得到上次給過什麼。

import { useMemo, useState } from 'react';
import {
  buildVars, missingVars, renderTemplate, VAR_NAMES,
  type CandidateProfile, type LetterKind, type LetterRecord, type LetterTemplate,
} from './lib/letters.ts';
import type { Merchant } from './lib/merchants.ts';
import { Field, Sheet, copyText, inputCls, printText } from './ShopUI.tsx';

export function ProfileEditor({
  profile,
  onChange,
}: {
  profile: CandidateProfile;
  onChange: (p: CandidateProfile) => void;
}) {
  const set = <K extends keyof CandidateProfile>(k: K, v: CandidateProfile[K]) =>
    onChange({ ...profile, [k]: v });

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-soft/80">
        候選人檔案 — 品牌模組五步流程的產出放這裡，邀約信會自動套用。
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="姓名">
          <input value={profile.name} onChange={(e) => set('name', e.target.value)} className={inputCls} placeholder="林昱誠" />
        </Field>
        <Field label="職稱">
          <input value={profile.title} onChange={(e) => set('title', e.target.value)} className={inputCls} placeholder="台鳳里長候選人" />
        </Field>
      </div>
      <Field label="主標語（步驟 03 選的那句）">
        <input value={profile.slogan} onChange={(e) => set('slogan', e.target.value)} className={inputCls} placeholder="排水溝通了，再談別的。" />
      </Field>
      <Field label="三個特質（步驟 02，用頓號或逗號分隔）">
        <input
          value={profile.traits.join('、')}
          onChange={(e) => set('traits', e.target.value.split(/[、,，]/).map((s) => s.trim()).filter(Boolean))}
          className={inputCls}
          placeholder="跑最勤、修排水、會用手機"
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="聯絡方式">
          <input value={profile.contact} onChange={(e) => set('contact', e.target.value)} className={inputCls} placeholder="LINE @449kyids" />
        </Field>
        <Field label="活動資訊（邀請信用）">
          <input value={profile.eventInfo} onChange={(e) => set('eventInfo', e.target.value)} className={inputCls} placeholder="11/28 19:00 里活動中心" />
        </Field>
      </div>
      <Field label="報名連結">
        <input value={profile.eventUrl} onChange={(e) => set('eventUrl', e.target.value)} className={inputCls} placeholder="https://…" />
      </Field>
    </div>
  );
}

export function LetterSheet({
  merchant,
  profile,
  templates,
  orgLabel,
  todayISO,
  lastItem,
  lastVisit,
  operator,
  history,
  onClose,
  onSaveRecord,
  onSaveTemplate,
}: {
  merchant: Merchant;
  profile: CandidateProfile;
  templates: ReadonlyArray<LetterTemplate>;
  orgLabel: string;
  todayISO: string;
  lastItem: string;
  lastVisit: string;
  operator: string;
  history: ReadonlyArray<LetterRecord>;
  onClose: () => void;
  onSaveRecord: (r: Omit<LetterRecord, 'id'>) => void;
  onSaveTemplate: (t: Omit<LetterTemplate, 'id'>) => void;
}) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const template = templates.find((t) => t.id === templateId) ?? templates[0];
  const vars = useMemo(
    () =>
      buildVars({
        merchantName: merchant.name,
        contactTitle: merchant.contactTitle,
        category: merchant.category,
        hood: merchant.hood,
        orgLabel,
        profile,
        lastItem,
        lastVisit,
        todayISO,
      }),
    [merchant, orgLabel, profile, lastItem, lastVisit, todayISO],
  );

  // 換模板時重新渲染；候選人手動改過的內容不該被蓋掉，所以用 key 綁 templateId
  const [body, setBody] = useState(() => (template ? renderTemplate(template.body, vars) : ''));
  const [msg, setMsg] = useState('');
  const [saveName, setSaveName] = useState('');

  function pick(id: string) {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setTemplateId(id);
    setBody(renderTemplate(t.body, vars));
    setMsg('');
  }

  const missing = template ? missingVars(template.body, vars) : [];

  async function doCopy() {
    setMsg((await copyText(body)) ? '已複製，貼到 LINE 就能傳' : '複製失敗，請長按選取文字複製');
  }

  function doPrint() {
    if (!printText(`${merchant.name} — ${template?.name ?? '信'}`, body)) {
      setMsg('瀏覽器擋掉了列印視窗，請允許彈出視窗');
    }
  }

  function doSaveRecord() {
    if (!template) return;
    onSaveRecord({
      orgId: merchant.orgId,
      merchantId: merchant.id,
      templateName: template.name,
      kind: template.kind,
      body,
      at: todayISO,
      by: operator || '未署名',
    });
    setMsg('已存進這家店的往來紀錄');
  }

  function doSaveTemplate() {
    const name = saveName.trim();
    if (!name || !template) return;
    // 存回模板時把這家店的具體內容換回變數佔位，下次才套得上別家店
    let generic = body;
    for (const k of VAR_NAMES) {
      const v = vars[k];
      if (v && v.trim() !== '' && k !== '今天') generic = generic.split(v).join(`{{${k}}}`);
    }
    onSaveTemplate({ orgId: merchant.orgId, name, kind: template.kind, body: generic, builtin: false });
    setSaveName('');
    setMsg(`已存成模板「${name}」，下次直接選`);
  }

  return (
    <Sheet title={`邀約信 · ${merchant.name}`} onClose={onClose}>
      <div className="flex flex-wrap gap-2">
        {templates.map((t) => (
          <button
            key={t.id}
            onClick={() => pick(t.id)}
            className={`rounded-full px-3 py-1.5 text-sm ${
              t.id === templateId ? 'bg-ink text-paper' : 'border border-paper-line bg-white'
            }`}
          >
            {t.name}
            <span className="ml-1 text-[11px] opacity-60">{kindShort(t.kind)}</span>
          </button>
        ))}
      </div>

      {missing.length > 0 && (
        <p className="mt-3 rounded-lg border border-campaign/40 bg-campaign/5 px-3 py-2 text-xs text-campaign">
          還缺：{missing.join('、')} —— 到「工具 → 候選人檔案」補上，或直接在下面手動改掉。
        </p>
      )}

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={14}
        className="mt-3 w-full rounded-lg border border-paper-line bg-white p-3 font-serif text-[15px] leading-8 outline-none focus:border-ink-soft"
      />
      <p className="mt-1 text-xs text-ink-soft/70">
        直接改成你自己會講的話 —— 一封「太完整」的信反而不像人寫的。
      </p>

      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        <button onClick={doCopy} className="rounded-lg bg-ink px-4 py-2.5 font-medium text-paper">複製</button>
        <button onClick={doPrint} className="rounded-lg border border-ink/60 px-4 py-2.5">列印</button>
        <button onClick={doSaveRecord} className="rounded-lg border border-ink/60 px-4 py-2.5">存進往來紀錄</button>
      </div>
      {msg && <p className="mt-2 text-xs text-ink-soft">{msg}</p>}

      <div className="mt-4 flex items-end gap-2">
        <Field label="改好了？存成自己的模板（會自動換回變數）">
          <input value={saveName} onChange={(e) => setSaveName(e.target.value)} className={inputCls} placeholder="模板名稱，例：早餐店專用" />
        </Field>
        <button
          onClick={doSaveTemplate}
          disabled={!saveName.trim()}
          className="mb-0.5 shrink-0 rounded-lg border border-ink/60 px-3 py-2 text-sm disabled:opacity-30"
        >
          另存
        </button>
      </div>

      {history.length > 0 && (
        <div className="mt-4">
          <p className="text-xs text-ink-soft/80">給過這家店的信</p>
          <ul className="mt-1 space-y-1 text-xs text-ink-soft/75">
            {[...history].reverse().slice(0, 5).map((r) => (
              <li key={r.id}>{r.at} · {r.templateName}（{kindShort(r.kind)}）· {r.by}</li>
            ))}
          </ul>
        </div>
      )}
    </Sheet>
  );
}

function kindShort(k: LetterKind): string {
  return k === 'LINE 訊息' ? 'LINE' : k === '紙本遞出' ? '紙本' : '邀請';
}
