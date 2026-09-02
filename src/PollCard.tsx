import { useEffect, useState } from 'react';

// 陽光法案議題民調 — 一鍵表態、免登入（2026-09-02 計劃書）
//
// 資料管線（免後端）：寫入＝Google 表單 formResponse（no-cors POST）；
// 讀取＝回應試算表的 gviz JSONP（script 標籤載入，繞過 CORS）。
// 法律定調：議題民調（對「公開金流」制度的看法），非候選人支持度調查；
// 保守起見，投票日前 10 天（11/18）起隱藏統計數字、只收表態。
// 防重複：同一裝置投過即鎖（localStorage），刻意不做更強驗證——低摩擦優先。

const POLL_FORM =
  'https://docs.google.com/forms/d/e/1FAIpQLSeSuI2lDsNRQRY7naf_B8vCFegjnp8BPEeG3N8SuxQz3DZyHg/formResponse';
const ENTRY_CHOICE = 'entry.1035243037';
const ENTRY_REGION = 'entry.1391478850';
const SHEET_ID = '1ce9VKGKKJL4LevfSCqcMR8qszI9Dvi9vcu1_wOCGv8s';
export const SIGNUP_FORM =
  'https://docs.google.com/forms/d/e/1FAIpQLScyMUmyraHfbrFSpxaBSJzwvc_LYuWpVF4_Kh49ua3UrC6ypA/viewform';

const CHOICES = ['會更支持他', '不影響我的決定', '不會支持'] as const;
type Choice = (typeof CHOICES)[number];
const VOTED_KEY = 'cov-sunshine-vote';
const BLACKOUT_START = new Date('2026-11-18T00:00:00'); // 投票日前 10 天，保守隱藏統計

interface Tally {
  counts: Record<Choice, number>;
  total: number;
}

// gviz JSONP：以 script 標籤載入，callback 收表格後計數
let cbSeq = 0;
function fetchTally(): Promise<Tally> {
  return new Promise((resolve, reject) => {
    const cb = `__covPollCb${++cbSeq}`;
    const w = window as unknown as Record<string, unknown>;
    const script = document.createElement('script');
    const cleanup = () => {
      delete w[cb];
      script.remove();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('timeout'));
    }, 10_000);
    w[cb] = (resp: { table?: { rows?: Array<{ c: Array<{ v?: unknown } | null> }> } }) => {
      clearTimeout(timer);
      const counts: Record<Choice, number> = { 會更支持他: 0, 不影響我的決定: 0, 不會支持: 0 };
      let total = 0;
      for (const row of resp.table?.rows ?? []) {
        const choice = String(row.c?.[1]?.v ?? '') as Choice;
        const region = String(row.c?.[2]?.v ?? '');
        if (region.startsWith('TEST-')) continue; // 測試票不計
        if (choice in counts) {
          counts[choice]++;
          total++;
        }
      }
      cleanup();
      resolve({ counts, total });
    };
    script.src = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json;responseHandler:${cb}`;
    script.onerror = () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error('load failed'));
    };
    document.head.appendChild(script);
  });
}

async function submitVote(choice: Choice, region: string): Promise<void> {
  const body = new URLSearchParams();
  body.set(ENTRY_CHOICE, choice);
  body.set(ENTRY_REGION, region);
  await fetch(POLL_FORM, { method: 'POST', mode: 'no-cors', body });
}

function readVoted(): Choice | null {
  try {
    const v = localStorage.getItem(VOTED_KEY);
    return v && (CHOICES as readonly string[]).includes(v) ? (v as Choice) : null;
  } catch {
    return null;
  }
}

const nf = (n: number) => n.toLocaleString('zh-TW');

export default function PollCard({ regionCode }: { regionCode: string }) {
  const [voted, setVoted] = useState<Choice | null>(readVoted);
  const [tally, setTally] = useState<Tally | null>(null);
  const [busy, setBusy] = useState(false);
  const blackout = new Date() >= BLACKOUT_START;

  useEffect(() => {
    if (!blackout) fetchTally().then(setTally).catch(() => {});
  }, [blackout]);

  async function vote(c: Choice) {
    if (voted || busy) return;
    setBusy(true);
    try {
      await submitVote(c, regionCode);
      try {
        localStorage.setItem(VOTED_KEY, c);
      } catch {
        /* 私密視窗等情況，仍視為已投 */
      }
      setVoted(c);
      // 樂觀更新：先 +1，背景再抓一次真值
      setTally((t) =>
        t ? { counts: { ...t.counts, [c]: t.counts[c] + 1 }, total: t.total + 1 } : t,
      );
      setTimeout(() => fetchTally().then(setTally).catch(() => {}), 4000);
    } finally {
      setBusy(false);
    }
  }

  const supportPct =
    tally && tally.total > 0 ? Math.round((tally.counts['會更支持他'] / tally.total) * 100) : null;

  return (
    <section className="border-[3px] border-ink bg-white p-5 shadow-[5px_5px_0_0_var(--color-ink)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center bg-gold font-serif text-sm font-black text-ink">☀</span>
          <h2 className="font-serif text-xl font-black tracking-wide text-ink">陽光民調</h2>
        </div>
        <span className="bg-paper px-2 py-0.5 text-[11px] font-bold text-ink-soft">免登入 · 點一下</span>
      </div>
      <p className="mt-3 font-serif text-[16px] leading-relaxed font-black text-ink">
        如果里長候選人願意公開政治獻金與金流運用（參與政治獻金申報），你會？
      </p>
      <div className="mt-3 space-y-1.5">
        {CHOICES.map((c) => {
          const cnt = tally?.counts[c] ?? 0;
          const pct = tally && tally.total > 0 ? Math.round((cnt / tally.total) * 100) : 0;
          const mine = voted === c;
          return (
            <button
              key={c}
              onClick={() => vote(c)}
              disabled={!!voted || busy}
              className={`relative block w-full overflow-hidden border-[2.5px] px-3 py-2.5 text-left text-[14px] font-bold transition-colors ${
                mine
                  ? 'border-gold bg-gold/15 text-ink'
                  : voted
                    ? 'border-ink/20 text-ink-soft'
                    : 'cursor-pointer border-ink/40 text-ink hover:border-campaign hover:bg-campaign/5'
              }`}
            >
              {voted && !blackout && tally && (
                <span className="absolute inset-y-0 left-0 bg-gold/20" style={{ width: `${pct}%` }} />
              )}
              <span className="relative flex items-center justify-between">
                <span>
                  {mine && '✓ '}
                  {c}
                </span>
                {voted && !blackout && tally && (
                  <span className="font-serif tabular-nums">{pct}%（{nf(cnt)}）</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {voted ? (
        <p className="mt-3 border-l-[3px] border-gold bg-paper px-3 py-2 text-[13px] leading-relaxed text-ink">
          {blackout
            ? '已收到你的表態！統計數字將於投票日後公布。'
            : supportPct !== null
              ? `已收到你的表態！目前 ${supportPct}% 的人表示會更支持公開金流的候選人（共 ${nf(tally!.total)} 人表態）。`
              : '已收到你的表態，統計更新中…'}
        </p>
      ) : (
        !blackout &&
        tally &&
        tally.total > 0 && (
          <p className="mt-2 text-center text-[12px] text-ink-soft">已有 {nf(tally.total)} 人表態，點一下加入你的聲音</p>
        )
      )}
      <p className="mt-3 border-t border-paper-line pt-2 text-[11px] leading-relaxed text-ink-soft/70">
        議題民調（詢問對「公開金流」制度的看法），非候選人支持度調查、非科學抽樣，數字僅供風向參考。每裝置限表態一次；僅記錄選項與里代碼，不蒐集任何個資。
      </p>
    </section>
  );
}
