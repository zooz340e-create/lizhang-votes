// 友善商家地圖 — 候選人 CRM 第一版（互惠版）
//
// 產品前提（見 plans/2026-09-02-友善商家地圖.md）：
//  - 沿用本專案的免後端鐵律：資料只存這台裝置的 localStorage，不上傳伺服器。
//    對商家資料來說這同時是離線可用（現場網路差不吃資料）與個資風險最低。
//    代價是換裝置就沒了 → 所以「備份/還原」是必要功能，不是加分項。
//  - Google Maps 走輕連動：我們是主場，只單向往外送（一鍵導航、匯出 KML）。
//    Google 未開放寫回使用者的「我的地圖／已儲存清單」，那條路技術上不存在。
//  - 30 秒鐵律：新增一家店只要「店名 + 位置 + 態度」，其餘全部之後再補。
//    候選人在騎樓下單手操作，欄位多一格就少一家店。
//
// 這頁在 LINE 官方帳號貼連結即可直接開（LINE 內建瀏覽器），不需要 LIFF SDK——
// 沒有後端就不需要 LINE Login 取得身分，少一道設定就少一個上線阻塞。

import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  CATEGORIES, STANCES, ITEMS, CONSENT_TEXT, NO_CONSENT,
  cycleDaysOf, dueDateOf, latestPlacement, refillStatus, sortForField,
  publicMerchants, toPublicPayload, toKML, navUrl, grantConsent,
  retainUntilISO, daysBetween, addDays,
  type Merchant, type Placement, type Visit, type RefillStatus, type Stance,
} from './lib/merchants.ts';
import {
  EMPTY_PROFILE, builtinTemplates,
  type CandidateProfile, type LetterRecord, type LetterTemplate,
} from './lib/letters.ts';
import type { Purchase, Supplier } from './lib/supply.ts';
import { LetterSheet, ProfileEditor } from './ShopLetters.tsx';
import { SupplyTab } from './ShopSupply.tsx';
import { Field, Sheet, inputCls } from './ShopUI.tsx';

const STORAGE_KEY = 'cov-shops-v1';
const VOTE_DAY = '2026-11-28';
const ORG_ID = 'taifeng';
const ORG_LABEL = '台鳳里';
// 里中心概略座標，只用來決定地圖初始視野
const ORG_CENTER: [number, number] = [24.0757, 120.5407];

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface ShopState {
  operator: string; // 目前是誰在記錄（寫進 updatedBy / 同意紀錄）
  profile: CandidateProfile; // 品牌模組五步流程的產出，邀約信的素材來源
  merchants: Merchant[];
  placements: Placement[];
  visits: Visit[];
  templates: LetterTemplate[];
  letters: LetterRecord[];
  suppliers: Supplier[];
  purchases: Purchase[];
}

const EMPTY: ShopState = {
  operator: '', profile: EMPTY_PROFILE, merchants: [], placements: [], visits: [],
  templates: builtinTemplates(ORG_ID), letters: [], suppliers: [], purchases: [],
};

function loadState(): ShopState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const p = JSON.parse(raw) as Partial<ShopState>;
    // 舊版存檔沒有後面幾張表；內建模板每次啟動補回來（使用者另存的模板不動）
    const saved = p.templates ?? [];
    const builtins = builtinTemplates(ORG_ID);
    const merged = [...builtins, ...saved.filter((t) => !t.builtin)];
    return {
      operator: p.operator ?? '',
      profile: { ...EMPTY_PROFILE, ...(p.profile ?? {}) },
      merchants: p.merchants ?? [],
      placements: p.placements ?? [],
      visits: p.visits ?? [],
      templates: merged,
      letters: p.letters ?? [],
      suppliers: p.suppliers ?? [],
      purchases: p.purchases ?? [],
    };
  } catch {
    return EMPTY;
  }
}

const STATUS_LABEL: Record<RefillStatus, string> = {
  overdue: '逾期未補',
  due: '今天要補',
  soon: '快到期',
  ok: '還早',
  none: '待開發',
};
const STATUS_COLOR: Record<RefillStatus, string> = {
  overdue: '#c0392b',
  due: '#d99a1c',
  soon: '#d99a1c',
  ok: '#1c3a5e',
  none: '#8a8578',
};

function download(filename: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ShopApp() {
  const [state, setState] = useState<ShopState>(loadState);
  const [tab, setTab] = useState<'list' | 'map' | 'supply'>('list');
  const [quickName, setQuickName] = useState('');
  const [quickCoord, setQuickCoord] = useState<[number, number] | null>(null);
  const [geoMsg, setGeoMsg] = useState('');
  const [editing, setEditing] = useState<Merchant | null>(null);
  const [refilling, setRefilling] = useState<Merchant | null>(null);
  const [writing, setWriting] = useState<Merchant | null>(null);
  const [showTools, setShowTools] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const today = todayISO();
  const daysToVote = daysBetween(today, VOTE_DAY);

  const ordered = useMemo(
    () => sortForField(state.merchants, state.placements, today),
    [state.merchants, state.placements, today],
  );

  const stats = useMemo(() => {
    let friendly = 0, placed = 0, needRefill = 0, publicOk = 0;
    for (const m of state.merchants) {
      if (m.stance === '友善') friendly += 1;
      if (m.publicConsent.granted && m.stance !== '婉拒') publicOk += 1;
      const p = latestPlacement(m.id, state.placements);
      if (!p) continue;
      placed += 1;
      const s = refillStatus(today, dueDateOf(p));
      if ((s === 'overdue' || s === 'due') && m.stance !== '婉拒') needRefill += 1;
    }
    return { friendly, placed, needRefill, publicOk, total: state.merchants.length };
  }, [state.merchants, state.placements, today]);

  function statusOf(m: Merchant): RefillStatus {
    if (m.stance === '婉拒') return 'none';
    const p = latestPlacement(m.id, state.placements);
    return refillStatus(today, p ? dueDateOf(p) : null);
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setGeoMsg('這台裝置不支援定位，改用地址');
      return;
    }
    setGeoMsg('定位中…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setQuickCoord([pos.coords.latitude, pos.coords.longitude]);
        setGeoMsg(`已抓到位置（誤差約 ${Math.round(pos.coords.accuracy)} 公尺）`);
      },
      () => setGeoMsg('抓不到位置（可能沒開權限），店名先存，位置之後補'),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  // 30 秒鐵律：店名 + 位置 + 態度，三下完成
  function quickAdd(stance: Stance) {
    const name = quickName.trim();
    if (!name) return;
    const now = new Date().toISOString();
    const m: Merchant = {
      id: crypto.randomUUID(), orgId: ORG_ID, name, category: '', address: '',
      lat: quickCoord?.[0] ?? null, lng: quickCoord?.[1] ?? null, hood: '',
      contactTitle: '', phone: '', hours: '', stance, blurb: '',
      publicConsent: NO_CONSENT, considerationNote: '', note: '',
      retainUntil: retainUntilISO(VOTE_DAY),
      createdAt: now, updatedAt: now, updatedBy: state.operator || '未署名',
    };
    setState((p) => ({ ...p, merchants: [...p.merchants, m] }));
    setQuickName('');
    setQuickCoord(null);
    setGeoMsg('');
  }

  function saveMerchant(m: Merchant) {
    setState((p) => ({
      ...p,
      merchants: p.merchants.map((x) =>
        x.id === m.id ? { ...m, updatedAt: new Date().toISOString(), updatedBy: state.operator || '未署名' } : x,
      ),
    }));
    setEditing(null);
  }

  function removeMerchant(id: string) {
    setState((p) => ({
      ...p,
      merchants: p.merchants.filter((m) => m.id !== id),
      placements: p.placements.filter((x) => x.merchantId !== id),
      visits: p.visits.filter((x) => x.merchantId !== id),
    }));
    setEditing(null);
  }

  // 補貨＝同時留下鋪點紀錄與拜訪紀錄，兩者用途不同：
  // 鋪點算下次回訪日，拜訪是這家店的往來歷史。
  function recordRefill(m: Merchant, item: string, qty: number, refillDays: number) {
    const now = new Date().toISOString();
    const placement: Placement = {
      id: crypto.randomUUID(), orgId: ORG_ID, merchantId: m.id,
      item, qty, placedAt: today, refillDays, by: state.operator || '未署名',
    };
    const visit: Visit = {
      id: crypto.randomUUID(), orgId: ORG_ID, merchantId: m.id, at: today,
      by: state.operator || '未署名', result: '補貨', note: `${item} × ${qty}`,
    };
    setState((p) => ({
      ...p,
      placements: [...p.placements, placement],
      visits: [...p.visits, visit],
      merchants: p.merchants.map((x) => (x.id === m.id ? { ...x, updatedAt: now } : x)),
    }));
    setRefilling(null);
  }

  function logVisit(m: Merchant, result: Visit['result']) {
    const v: Visit = {
      id: crypto.randomUUID(), orgId: ORG_ID, merchantId: m.id, at: today,
      by: state.operator || '未署名', result, note: '',
    };
    setState((p) => ({ ...p, visits: [...p.visits, v] }));
  }

  function saveLetter(r: Omit<LetterRecord, 'id'>) {
    setState((p) => ({ ...p, letters: [...p.letters, { ...r, id: crypto.randomUUID() }] }));
  }
  function saveTemplate(t: Omit<LetterTemplate, 'id'>) {
    setState((p) => ({ ...p, templates: [...p.templates, { ...t, id: crypto.randomUUID() }] }));
  }
  function saveSupplier(sup: Supplier) {
    setState((p) => ({
      ...p,
      suppliers: p.suppliers.some((x) => x.id === sup.id)
        ? p.suppliers.map((x) => (x.id === sup.id ? sup : x))
        : [...p.suppliers, sup],
    }));
  }
  function removeSupplier(id: string) {
    // 採購紀錄刻意留著——帳不能因為刪廠商就消失，supplierName 已冗餘存過一份
    setState((p) => ({ ...p, suppliers: p.suppliers.filter((x) => x.id !== id) }));
  }
  function addPurchase(pur: Omit<Purchase, 'id'>) {
    setState((p) => ({ ...p, purchases: [...p.purchases, { ...pur, id: crypto.randomUUID() }] }));
  }

  function exportKML() {
    download(`${ORG_LABEL}-友善商家-${today}.kml`, toKML(`${ORG_LABEL} 友善商家`, state.merchants), 'application/vnd.google-earth.kml+xml');
  }
  function exportPublic() {
    const payload = { org: ORG_LABEL, generatedAt: today, entries: toPublicPayload(state.merchants) };
    download(`${ORG_LABEL}-公開店家-${today}.json`, JSON.stringify(payload, null, 2), 'application/json');
  }
  function exportBackup() {
    download(`${ORG_LABEL}-商家備份-${today}.json`, JSON.stringify(state, null, 2), 'application/json');
  }
  function importBackup(file: File) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const p = JSON.parse(String(r.result)) as Partial<ShopState>;
        if (!Array.isArray(p.merchants)) throw new Error('格式不對');
        const builtins = builtinTemplates(ORG_ID);
        setState({
          operator: p.operator ?? state.operator,
          profile: { ...EMPTY_PROFILE, ...(p.profile ?? {}) },
          merchants: p.merchants, placements: p.placements ?? [], visits: p.visits ?? [],
          templates: [...builtins, ...(p.templates ?? []).filter((t) => !t.builtin)],
          letters: p.letters ?? [], suppliers: p.suppliers ?? [], purchases: p.purchases ?? [],
        });
      } catch {
        setGeoMsg('還原失敗：這不是備份檔');
      }
    };
    r.readAsText(file);
  }

  const expired = state.merchants.filter((m) => m.retainUntil && m.retainUntil < today).length;

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 pb-28 font-sans">
      <header className="pt-6 pb-3">
        <h1 className="font-serif text-2xl font-black tracking-tight">{ORG_LABEL} 友善商家</h1>
        <p className="mt-1 text-xs text-ink-soft/80">
          距投票日 {daysToVote} 天 · 資料只存這台裝置，不上傳伺服器
        </p>
        <div className="mt-3 grid grid-cols-4 gap-2 text-center">
          <Stat label="商家" value={stats.total} />
          <Stat label="友善" value={stats.friendly} />
          <Stat label="已鋪點" value={stats.placed} />
          <Stat label="該補貨" value={stats.needRefill} accent={stats.needRefill > 0} />
        </div>
      </header>

      {expired > 0 && (
        <p className="mb-3 rounded-lg border border-campaign/40 bg-campaign/5 px-3 py-2 text-xs text-campaign">
          有 {expired} 筆已過保存期限（投票日 +6 個月），請匯出備份後刪除。
        </p>
      )}

      {/* 30 秒新增：店名 → 位置 → 態度，三下完成 */}
      <section className="rounded-xl border border-paper-line bg-white/70 p-3">
        <input
          value={quickName}
          onChange={(e) => setQuickName(e.target.value)}
          placeholder="店名（例：阿美早餐店）"
          className="w-full rounded-lg border border-paper-line bg-white px-3 py-2.5 text-base outline-none focus:border-ink-soft"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={useMyLocation}
            className={`rounded-lg border px-3 py-2 text-sm ${quickCoord ? 'border-ink bg-ink text-paper' : 'border-paper-line bg-white'}`}
          >
            {quickCoord ? '✓ 已帶入位置' : '📍 用目前位置'}
          </button>
          <span className="text-xs text-ink-soft/70">{geoMsg}</span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {STANCES.map((s) => (
            <button
              key={s}
              disabled={!quickName.trim()}
              onClick={() => quickAdd(s)}
              className="rounded-lg border border-ink/70 py-2 text-sm font-medium disabled:opacity-30"
            >
              存為「{s}」
            </button>
          ))}
        </div>
      </section>

      <div className="mt-4 flex gap-2">
        {(['list', 'map', 'supply'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-1.5 text-sm ${tab === t ? 'bg-ink text-paper' : 'border border-paper-line bg-white'}`}
          >
            {t === 'list' ? '清單' : t === 'map' ? '地圖' : '備料'}
          </button>
        ))}
        <button onClick={() => setShowTools((v) => !v)} className="ml-auto rounded-full border border-paper-line bg-white px-4 py-1.5 text-sm">
          工具
        </button>
      </div>

      {showTools && (
        <section className="mt-3 space-y-2 rounded-xl border border-paper-line bg-white/70 p-3 text-sm">
          <label className="block">
            <span className="text-xs text-ink-soft/80">記錄者（會寫進每筆資料與同意紀錄）</span>
            <input
              value={state.operator}
              onChange={(e) => setState((p) => ({ ...p, operator: e.target.value }))}
              placeholder="你的名字"
              className="mt-1 w-full rounded-lg border border-paper-line px-3 py-2"
            />
          </label>
          <div className="border-t border-paper-line pt-3">
            <ProfileEditor profile={state.profile} onChange={(profile) => setState((p) => ({ ...p, profile }))} />
          </div>
          <div className="flex flex-wrap gap-2 border-t border-paper-line pt-3">
            <button onClick={exportKML} className="rounded-lg border border-ink/60 px-3 py-2">匯出 KML（丟進我的地圖）</button>
            <button onClick={exportPublic} className="rounded-lg border border-ink/60 px-3 py-2">
              匯出公開店家（{stats.publicOk}）
            </button>
            <button onClick={exportBackup} className="rounded-lg border border-ink/60 px-3 py-2">匯出備份</button>
            <label className="cursor-pointer rounded-lg border border-ink/60 px-3 py-2">
              還原備份
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && importBackup(e.target.files[0])}
              />
            </label>
          </div>
          <p className="text-xs text-ink-soft/70">
            換手機或清除瀏覽資料，這裡的資料就會消失 —— 每次掃街完記得匯出備份。
            「公開店家」只含明示同意的商家，且不含電話與內部備註。
          </p>
        </section>
      )}

      {tab === 'supply' ? (
        <SupplyTab
          orgId={ORG_ID}
          suppliers={state.suppliers}
          purchases={state.purchases}
          placements={state.placements}
          profile={state.profile}
          operator={state.operator}
          todayISO={today}
          onSaveSupplier={saveSupplier}
          onRemoveSupplier={removeSupplier}
          onAddPurchase={addPurchase}
        />
      ) : tab === 'map' ? (
        <MapView merchants={state.merchants} statusOf={statusOf} onPick={setEditing} />
      ) : (
        <ul className="mt-3 space-y-2">
          {ordered.length === 0 && (
            <li className="rounded-xl border border-dashed border-paper-line px-4 py-10 text-center text-sm text-ink-soft/70">
              還沒有商家。上面打店名、按位置、選態度就存好了。
            </li>
          )}
          {ordered.map((m) => {
            const st = statusOf(m);
            const p = latestPlacement(m.id, state.placements);
            const due = p ? dueDateOf(p) : null;
            return (
              <li key={m.id} className="rounded-xl border border-paper-line bg-white/70 p-3">
                <div className="flex items-start gap-2">
                  <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[st] }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate font-medium">{m.name}</span>
                      <span className="shrink-0 text-xs" style={{ color: STATUS_COLOR[st] }}>
                        {STATUS_LABEL[st]}
                        {st === 'overdue' && due ? `（${-daysBetween(today, due)} 天）` : ''}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-ink-soft/75">
                      {[m.stance, m.category, m.hood, p ? `${p.item}×${p.qty} · ${p.placedAt} 放` : '尚未鋪點']
                        .filter(Boolean)
                        .join(' · ')}
                      {m.publicConsent.granted ? ' · 已同意公開' : ''}
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-sm">
                  <a
                    href={navUrl(m)}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-ink/50 px-3 py-1.5"
                  >
                    導航
                  </a>
                  <button onClick={() => setRefilling(m)} className="rounded-lg border border-ink/50 px-3 py-1.5">補貨</button>
                  <button onClick={() => setWriting(m)} className="rounded-lg border border-ink/50 px-3 py-1.5">邀約信</button>
                  <button onClick={() => logVisit(m, '沒開門')} className="rounded-lg border border-paper-line px-3 py-1.5 text-ink-soft">沒開門</button>
                  <button onClick={() => setEditing(m)} className="ml-auto rounded-lg border border-paper-line px-3 py-1.5 text-ink-soft">編輯</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {refilling && (
        <RefillSheet merchant={refilling} onClose={() => setRefilling(null)} onSave={recordRefill} />
      )}
      {writing && (
        <LetterSheet
          merchant={writing}
          profile={state.profile}
          templates={state.templates}
          orgLabel={ORG_LABEL}
          todayISO={today}
          lastItem={latestPlacement(writing.id, state.placements)?.item ?? ''}
          lastVisit={lastVisitSummary(writing.id, state.visits)}
          operator={state.operator}
          history={state.letters.filter((l) => l.merchantId === writing.id)}
          onClose={() => setWriting(null)}
          onSaveRecord={saveLetter}
          onSaveTemplate={saveTemplate}
        />
      )}
      {editing && (
        <EditSheet
          merchant={editing}
          operator={state.operator}
          visits={state.visits.filter((v) => v.merchantId === editing.id)}
          onClose={() => setEditing(null)}
          onSave={saveMerchant}
          onRemove={removeMerchant}
        />
      )}

      <footer className="mt-10 space-y-1 border-t border-paper-line pt-4 text-xs text-ink-soft/70">
        <p>本頁為競選陸戰內部工具。商家資料僅供鋪點與回訪管理，保存至投票日 +6 個月。</p>
        <p>公開「友善店家」頁需商家明示同意；同意可隨時撤回，撤回即下架。</p>
      </footer>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={`rounded-lg border px-2 py-2 ${accent ? 'border-campaign/50 bg-campaign/5' : 'border-paper-line bg-white/60'}`}>
      <div className={`font-serif text-xl font-black ${accent ? 'text-campaign' : ''}`}>{value}</div>
      <div className="text-[11px] text-ink-soft/75">{label}</div>
    </div>
  );
}

// ── 地圖：Leaflet + OSM 圖磚（不需要 API 金鑰，上線不卡在申請）──────────
function MapView({
  merchants,
  statusOf,
  onPick,
}: {
  merchants: ReadonlyArray<Merchant>;
  statusOf: (m: Merchant) => RefillStatus;
  onPick: (m: Merchant) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!boxRef.current || mapRef.current) return;
    const map = L.map(boxRef.current).setView(ORG_CENTER, 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const pts: L.LatLngExpression[] = [];
    for (const m of merchants) {
      if (m.lat == null || m.lng == null) continue;
      pts.push([m.lat, m.lng]);
      const color = STATUS_COLOR[statusOf(m)];
      L.circleMarker([m.lat, m.lng], {
        radius: 8, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1,
      })
        .bindTooltip(m.name, { direction: 'top' })
        .on('click', () => onPick(m))
        .addTo(layer);
    }
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 17 });
    // 從清單切過來時容器尺寸才確定，要叫 Leaflet 重算一次
    setTimeout(() => map.invalidateSize(), 0);
  }, [merchants, statusOf, onPick]);

  const noCoord = merchants.filter((m) => m.lat == null).length;
  return (
    <div className="mt-3">
      <div ref={boxRef} className="h-[60vh] w-full overflow-hidden rounded-xl border border-paper-line" />
      {noCoord > 0 && (
        <p className="mt-2 text-xs text-ink-soft/70">{noCoord} 家沒有座標，地圖上看不到 —— 下次經過時按「編輯 → 用目前位置」補上。</p>
      )}
    </div>
  );
}

// ── 快速補貨 ───────────────────────────────────────────────
function RefillSheet({
  merchant,
  onClose,
  onSave,
}: {
  merchant: Merchant;
  onClose: () => void;
  onSave: (m: Merchant, item: string, qty: number, refillDays: number) => void;
}) {
  const [item, setItem] = useState<string>(ITEMS[0].name);
  const [qty, setQty] = useState(5);
  const [days, setDays] = useState(cycleDaysOf(ITEMS[0].name));

  function pick(name: string) {
    setItem(name);
    setDays(cycleDaysOf(name));
  }

  return (
    <Sheet title={`補貨 · ${merchant.name}`} onClose={onClose}>
      <div className="grid grid-cols-3 gap-2">
        {ITEMS.map((i) => (
          <button
            key={i.name}
            onClick={() => pick(i.name)}
            className={`rounded-lg border py-2 text-sm ${item === i.name ? 'border-ink bg-ink text-paper' : 'border-paper-line bg-white'}`}
          >
            {i.name}
          </button>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <span className="text-sm">數量</span>
        <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="h-9 w-9 rounded-lg border border-paper-line">−</button>
        <span className="w-10 text-center font-serif text-xl font-black">{qty}</span>
        <button onClick={() => setQty((q) => q + 1)} className="h-9 w-9 rounded-lg border border-paper-line">＋</button>
        <label className="ml-auto flex items-center gap-2 text-sm">
          <span>{days} 天後回訪</span>
          <input
            type="number"
            value={days}
            min={1}
            onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))}
            className="w-16 rounded-lg border border-paper-line px-2 py-1.5"
          />
        </label>
      </div>
      <p className="mt-2 text-xs text-ink-soft/70">下次回訪日：{addDays(todayISO(), days)}</p>
      <button
        onClick={() => onSave(merchant, item, qty, days)}
        className="mt-4 w-full rounded-lg bg-ink py-3 font-medium text-paper"
      >
        記錄今天補了 {item} × {qty}
      </button>
    </Sheet>
  );
}

// ── 完整編輯（含公開同意）────────────────────────────────────
function EditSheet({
  merchant,
  operator,
  visits,
  onClose,
  onSave,
  onRemove,
}: {
  merchant: Merchant;
  operator: string;
  visits: ReadonlyArray<Visit>;
  onClose: () => void;
  onSave: (m: Merchant) => void;
  onRemove: (id: string) => void;
}) {
  const [d, setD] = useState<Merchant>(merchant);
  const [geo, setGeo] = useState('');
  const set = <K extends keyof Merchant>(k: K, v: Merchant[K]) => setD((p) => ({ ...p, [k]: v }));

  function locate() {
    if (!navigator.geolocation) return setGeo('這台裝置不支援定位');
    setGeo('定位中…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setD((p) => ({ ...p, lat: pos.coords.latitude, lng: pos.coords.longitude }));
        setGeo('已更新座標');
      },
      () => setGeo('抓不到位置'),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  function toggleConsent(next: boolean) {
    set('publicConsent', next ? grantConsent(operator || '未署名', new Date().toISOString()) : NO_CONSENT);
  }

  return (
    <Sheet title={merchant.name} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <Field label="店名"><input value={d.name} onChange={(e) => set('name', e.target.value)} className={inputCls} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="類型">
            <select value={d.category} onChange={(e) => set('category', e.target.value as Merchant['category'])} className={inputCls}>
              <option value="">未分類</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="態度">
            <select value={d.stance} onChange={(e) => set('stance', e.target.value as Stance)} className={inputCls}>
              {STANCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        <Field label="地址"><input value={d.address} onChange={(e) => set('address', e.target.value)} className={inputCls} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="鄰／區塊"><input value={d.hood} onChange={(e) => set('hood', e.target.value)} className={inputCls} placeholder="第 5 鄰" /></Field>
          <Field label="負責人稱謂"><input value={d.contactTitle} onChange={(e) => set('contactTitle', e.target.value)} className={inputCls} placeholder="陳老闆" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="電話"><input value={d.phone} onChange={(e) => set('phone', e.target.value)} className={inputCls} inputMode="tel" /></Field>
          <Field label="營業時間"><input value={d.hours} onChange={(e) => set('hours', e.target.value)} className={inputCls} placeholder="05:30–11:00" /></Field>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={locate} className="rounded-lg border border-ink/60 px-3 py-2">📍 用目前位置更新座標</button>
          <span className="text-xs text-ink-soft/70">
            {d.lat != null ? `${d.lat.toFixed(5)}, ${d.lng?.toFixed(5)}` : '尚無座標'} {geo}
          </span>
        </div>

        <div className="rounded-lg border border-paper-line bg-white/60 p-3">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={d.publicConsent.granted}
              onChange={(e) => toggleConsent(e.target.checked)}
              className="mt-1"
            />
            <span>
              <span className="font-medium">已向店家說明並取得公開同意</span>
              <span className="mt-1 block text-xs text-ink-soft/75">{CONSENT_TEXT}</span>
              {d.publicConsent.granted && (
                <span className="mt-1 block text-xs text-ink-soft/60">
                  {d.publicConsent.at.slice(0, 16).replace('T', ' ')} · {d.publicConsent.by} · {d.publicConsent.version}
                </span>
              )}
            </span>
          </label>
          {d.publicConsent.granted && (
            <div className="mt-2">
              <Field label="一句店家介紹（會出現在公開頁）">
                <input value={d.blurb} onChange={(e) => set('blurb', e.target.value)} className={inputCls} placeholder="古早味蛋餅，開了三十年" />
              </Field>
            </div>
          )}
        </div>

        <Field label="對價說明（法遵欄位：陳列空間與曝光的性質）">
          <input value={d.considerationNote} onChange={(e) => set('considerationNote', e.target.value)} className={inputCls} placeholder="待律師確認" />
        </Field>
        <Field label="內部備註（永不進公開頁）">
          <textarea value={d.note} onChange={(e) => set('note', e.target.value)} rows={2} className={inputCls} />
        </Field>

        {visits.length > 0 && (
          <div>
            <p className="text-xs text-ink-soft/80">往來紀錄</p>
            <ul className="mt-1 space-y-1 text-xs text-ink-soft/75">
              {[...visits].reverse().slice(0, 8).map((v) => (
                <li key={v.id}>{v.at} · {v.result}{v.note ? ` · ${v.note}` : ''} · {v.by}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button onClick={() => onSave(d)} className="flex-1 rounded-lg bg-ink py-3 font-medium text-paper">儲存</button>
          <button
            onClick={() => { if (confirm(`刪除「${merchant.name}」與它的所有紀錄？`)) onRemove(merchant.id); }}
            className="rounded-lg border border-campaign/50 px-4 py-3 text-campaign"
          >
            刪除
          </button>
        </div>
        <p className="text-xs text-ink-soft/60">保存期限 {d.retainUntil}（投票日 +6 個月）</p>
      </div>
    </Sheet>
  );
}

// 邀約信要引用「上次互動」，格式跟編輯頁的往來紀錄一致
function lastVisitSummary(merchantId: string, visits: ReadonlyArray<Visit>): string {
  let best: Visit | null = null;
  for (const v of visits) {
    if (v.merchantId !== merchantId) continue;
    if (!best || v.at > best.at) best = v;
  }
  return best ? `${best.at} ${best.result}` : '';
}
