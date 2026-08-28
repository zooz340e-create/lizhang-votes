import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { depositThreshold, winInsight, competition } from './lib/calc';
import { loadCounty, type VillageRow } from './lib/data';

// 東區限定選情站 — 彰化市東區 22 里
//
// 這一頁只做一件事：讓考慮參選的東區里民 30 秒看到「我的里有機會」，
// 然後加 LINE 留下聯絡（名單容器 = LINE，不蒐集 Email、無後端）。
// 其他區塊（案例/測驗/智販機願景）都是為這個轉換服務的配菜。
//
// 法律紅線（勿改動）：
//  - 保證金 NT$50,000（中選會 111 年公告，web.cec.gov.tw/central/article/45843）
//  - 智販機/贊助所得 = COV 計畫營收（陪跑服務），不收受、不代收政治獻金；
//    政治獻金須由捐贈人直接捐入監察院許可之候選人專戶。

// ⚠️ 名單容器：換成用戶私人 LINE 加好友連結（line.me/ti/p/…）後即可上線定版
const LINE_URL = 'https://line.me/R/ti/p/%40449kyids';
const LINE_LABEL = '加 LINE 領取';

const REG_START = '2026-08-31';
const REG_DEADLINE = '2026-09-10';
const VOTE_DAY = '2026-11-28';

// 彰化市東區 22 里（etl/data/changhua_east_villages.json）
const EAST_VILLAGES = [
  '阿夷里', '寶廍里', '國聖里', '三村里', '和調里', '牛埔里', '福山里', '田中里',
  '石牌里', '快官里', '竹巷里', '古夷里', '香山里', '安溪里', '竹中里', '大竹里',
  '茄苳里', '茄南里', '福田里', '台鳳里', '中庄里', '復興里',
];

const nf = (n: number) => n.toLocaleString('zh-TW');

function daysUntil(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((new Date(`${iso}T00:00:00`).getTime() - today.getTime()) / 86_400_000);
}

// ── 三題價值測驗 ─────────────────────────────────────────
interface QuizOption { label: string; type: 'do' | 'care' | 'new' }
interface QuizQ { q: string; options: QuizOption[] }
const QUIZ: QuizQ[] = [
  {
    q: '走在里裡，最讓你皺眉的是？',
    options: [
      { label: '路燈壞很久、水溝臭、沒人處理', type: 'do' },
      { label: '獨居長輩沒人看、小孩放學沒地方去', type: 'care' },
      { label: '公告還在用紙貼電線桿，年輕人完全無感', type: 'new' },
    ],
  },
  {
    q: '如果里長換你做主，第一件事是？',
    options: [
      { label: '列清單、盯進度，一件一件修好', type: 'do' },
      { label: '辦共餐、串起鄰里互相照應', type: 'care' },
      { label: '開 LINE 社群、讓大小事都查得到', type: 'new' },
    ],
  },
  {
    q: '你願意為改變做到哪一步？',
    options: [
      { label: '投票日一定到，全家一起去', type: 'do' },
      { label: '幫忙轉發、跟鄰居聊起來', type: 'care' },
      { label: '直接報名志工，甚至想過自己選', type: 'new' },
    ],
  },
];
const QUIZ_RESULT: Record<QuizOption['type'], { name: string; emoji: string; desc: string; policy: string }> = {
  do: {
    name: '實幹派選民',
    emoji: '🔧',
    desc: '你受不了「反映了也沒用」。你要的不是口號，是修好的路燈和通暢的水溝。',
    policy: '對味的政見：里務進度公開追蹤——每一件反映案編號列管，處理到哪、卡在哪，全里看得到。',
  },
  care: {
    name: '守護派選民',
    emoji: '🤝',
    desc: '你眼裡的里是「人」：長輩、小孩、鄰居。你要一個把人放在前面的社區。',
    policy: '對味的政見：長輩共餐＋放學據點——用里民活動中心把一個人的難題變成一群人的日常。',
  },
  new: {
    name: '更新派選民',
    emoji: '⚡',
    desc: '你知道里可以不一樣——公告數位化、決策透明化、年輕人回得來。',
    policy: '對味的政見：數位里政——LINE 社群公告、線上反映、預算透明，把里帶進 2026。',
  },
};

// ── 小元件 ──────────────────────────────────────────────
function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`border-[3px] border-ink bg-white p-5 shadow-[5px_5px_0_0_var(--color-ink)] ${className}`}>
      {children}
    </section>
  );
}

function SectionTag({ no, label }: { no: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-7 w-7 items-center justify-center bg-campaign font-serif text-sm font-black text-paper">
        {no}
      </span>
      <h2 className="font-serif text-xl font-black tracking-wide text-ink">{label}</h2>
    </div>
  );
}

function LineButton({ children = LINE_LABEL, big = false }: { children?: React.ReactNode; big?: boolean }) {
  return (
    <a
      href={LINE_URL}
      target="_blank"
      rel="noreferrer"
      className={`block w-full cursor-pointer border-[3px] border-ink bg-[#06C755] text-center font-serif font-black tracking-widest text-white shadow-[4px_4px_0_0_var(--color-ink)] transition-transform hover:-translate-y-0.5 ${big ? 'py-4 text-xl' : 'py-3 text-base'}`}
    >
      {children}
    </a>
  );
}

// 智販機動畫（純 CSS，投幣→機身微震→掉貨→取貨口亮）
function VendingHero() {
  return (
    <div className="relative mx-auto mt-4 h-56 w-40 select-none" aria-hidden="true">
      <style>{`
        @keyframes coinDrop { 0%{transform:translateY(-30px);opacity:0} 25%{opacity:1} 55%{transform:translateY(26px);opacity:1} 70%{opacity:0} 100%{transform:translateY(-30px);opacity:0} }
        @keyframes shake { 0%,55%,100%{transform:translateX(0)} 58%{transform:translateX(-2px)} 62%{transform:translateX(2px)} 66%{transform:translateX(0)} }
        @keyframes capsuleDrop { 0%,60%{transform:translateY(0);opacity:0} 65%{opacity:1} 85%{transform:translateY(74px);opacity:1} 92%{transform:translateY(70px)} 100%{transform:translateY(74px);opacity:0} }
        @keyframes trayGlow { 0%,80%,100%{box-shadow:none} 86%,94%{box-shadow:0 0 12px 3px var(--color-gold)} }
      `}</style>
      {/* 機身 */}
      <div className="absolute inset-0 border-[3px] border-paper/80 bg-campaign-hero" style={{ animation: 'shake 4s infinite' }}>
        {/* 展示窗：三排小物 */}
        <div className="absolute top-2 left-2 grid h-24 w-[calc(100%-16px)] grid-cols-3 gap-1 border-2 border-paper/60 bg-ink/40 p-1">
          {['⭐', '🎽', '🧢', '☕', '🍅', '🎟️', '📛', '🥬', '⭐'].map((e, i) => (
            <span key={i} className="flex items-center justify-center text-sm">{e}</span>
          ))}
        </div>
        {/* 投幣口 + 硬幣 */}
        <div className="absolute top-28 right-2 h-6 w-8 border-2 border-paper/60 bg-ink/40">
          <span className="absolute left-1/2 -translate-x-1/2 text-sm" style={{ animation: 'coinDrop 4s infinite' }}>🪙</span>
        </div>
        <p className="absolute top-28 left-2 font-serif text-[9px] leading-tight font-bold text-paper/80">投下<br />支持</p>
        {/* 掉落中的膠囊 */}
        <span className="absolute top-[104px] left-1/2 -translate-x-1/2 text-lg" style={{ animation: 'capsuleDrop 4s infinite' }}>⭐</span>
        {/* 取貨口 */}
        <div className="absolute bottom-2 left-1/2 h-8 w-24 -translate-x-1/2 border-2 border-paper/60 bg-ink/60" style={{ animation: 'trayGlow 4s infinite' }} />
      </div>
    </div>
  );
}

// ── 主頁面 ──────────────────────────────────────────────
export default function EastApp() {
  const [rows, setRows] = useState<VillageRow[]>([]);
  const [error, setError] = useState('');
  const [village, setVillage] = useState('');
  const [answers, setAnswers] = useState<Array<QuizOption['type'] | null>>([null, null, null]);
  const [qr, setQr] = useState('');

  useEffect(() => {
    loadCounty('10007')
      .then((vs) => setRows(vs.filter((x) => x.district === '彰化市' && EAST_VILLAGES.includes(x.village))))
      .catch(() => setError('資料載入失敗，請重新整理'));
  }, []);

  useEffect(() => {
    QRCode.toDataURL(LINE_URL, { margin: 1, width: 220, color: { dark: '#0b1f3a', light: '#f6f1e7' } })
      .then(setQr)
      .catch(() => {});
  }, []);

  const v = useMemo(() => rows.find((x) => x.village === village), [rows, village]);
  const result = useMemo(() => {
    if (!v) return null;
    return { deposit: depositThreshold(v), win: winInsight(v), comp: competition(v) };
  }, [v]);

  const quizDone = answers.every((a) => a !== null);
  const quizType = useMemo(() => {
    if (!quizDone) return null;
    const score: Record<QuizOption['type'], number> = { do: 0, care: 0, new: 0 };
    for (const a of answers) if (a) score[a]++;
    return (Object.entries(score) as Array<[QuizOption['type'], number]>).sort((a, b) => b[1] - a[1])[0][0];
  }, [answers, quizDone]);

  const dReg = daysUntil(REG_DEADLINE);
  const dVote = daysUntil(VOTE_DAY);

  return (
    <div className="mx-auto min-h-screen max-w-xl px-4 pb-12">
      {/* ── Hero ── */}
      <header className="mt-5 border-[3px] border-ink bg-ink text-paper">
        <div className="flex items-center justify-between border-b border-paper/30 px-4 py-1 text-[11px] font-medium tracking-widest text-gold-soft">
          <span>彰 化 東 區 限 定 · 22 里</span>
          <a href="./" className="underline decoration-dotted underline-offset-2 hover:text-paper">全臺版 →</a>
        </div>
        <div className="px-4 py-6 text-center">
          <p className="font-serif text-sm font-bold tracking-[0.3em] text-gold-soft">COV 素人里長繁星計畫</p>
          <h1 className="mt-2 font-serif text-[34px] leading-tight font-black tracking-tight">
            東區的更新計畫，<br />你來決定。
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-paper/80">
            很多里，連投票都不用投——因為只有一個人登記。<br />
            這一次，東區 22 個里，我們把選擇放回你手上。
          </p>
          <VendingHero />
        </div>
        <div className="flex divide-x divide-paper/30 border-t border-paper/30 text-center">
          <div className="flex-1 py-2">
            <p className="text-[11px] text-paper/70">候選人登記 8/31 開跑，距截止 9/10</p>
            <p className="font-serif text-2xl font-black text-gold-soft tabular-nums">{dReg > 0 ? `剩 ${dReg} 天` : '已截止'}</p>
          </div>
          <div className="flex-1 py-2">
            <p className="text-[11px] text-paper/70">距投票日 11/28</p>
            <p className="font-serif text-2xl font-black tabular-nums">{dVote} 天</p>
          </div>
        </div>
      </header>

      <div className="mt-5 space-y-5">
        {/* ── ① 22里限定計算機 ── */}
        <Panel>
          <SectionTag no="①" label="你的里，要幾票？" />
          <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
            東區限定版——只有這 22 個里。選你的里，30 秒看懂你的機會。
          </p>
          <div className="relative mt-3">
            <select
              aria-label="選擇村里"
              value={village}
              onChange={(e) => setVillage(e.target.value)}
              className={`w-full cursor-pointer appearance-none border-[3px] border-ink bg-white py-3.5 pr-10 pl-4 font-serif text-xl font-black ${village ? 'text-ink' : 'text-ink-soft/60'} focus:border-campaign focus:outline-none`}
            >
              <option value="">選擇你的里 👇</option>
              {EAST_VILLAGES.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <svg className="pointer-events-none absolute top-1/2 right-3 h-5 w-5 -translate-y-1/2 text-campaign" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          {error && <p className="mt-2 border-[3px] border-campaign bg-campaign/5 px-3 py-2 text-sm font-bold text-campaign">⚠ {error}</p>}

          {result && v && (
            <div className="mt-4 space-y-3">
              <div className="border-[3px] border-ink bg-campaign-hero p-4 text-paper">
                <p className="text-xs font-bold text-paper/80">保住 5 萬元保證金，至少要</p>
                <p className="font-serif text-5xl font-black tabular-nums">{nf(result.deposit.votes)} <span className="text-2xl">票</span></p>
                <p className="mt-1 text-[11px] text-paper/70">《選罷法》門檻＝選舉人數 {nf(result.deposit.electorate)} × 10%（保證金 NT$50,000，中選會公告）</p>
              </div>
              <div className="flex gap-3">
                <div className="flex-1 border-[3px] border-ink bg-paper p-3 text-center">
                  <p className="text-[11px] font-bold text-ink-soft">上屆當選票</p>
                  <p className="font-serif text-2xl font-black text-ink tabular-nums">
                    {result.win.lastWinner ? nf(result.win.lastWinner.votes) : '—'}
                  </p>
                  {result.win.lastWinner && <p className="text-[11px] text-ink-soft">{result.win.lastWinner.name}{result.win.lastWinner.uncontested && '（同額）'}</p>}
                </div>
                <div className="flex-1 border-[3px] border-ink bg-paper p-3 text-center">
                  <p className="text-[11px] font-bold text-ink-soft">參選機會</p>
                  <p className="font-serif text-2xl font-black text-campaign">{result.comp.tier}</p>
                  <p className="text-[11px] text-ink-soft tabular-nums">機會指數 {result.comp.score}/100</p>
                </div>
              </div>
              {/* 轉換閥門：健檢報告 CTA */}
              <div className="border-[3px] border-dashed border-campaign bg-campaign/5 p-4">
                <p className="font-serif text-base leading-relaxed font-black text-ink">
                  想看 <span className="text-campaign">{v.village}</span> 的完整選情健檢？
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
                  8 大選民輪廓、游離票與空氣票分析、陸戰怎麼打——COV 教練幫你把這個里拆給你看，<b>免費</b>。
                </p>
                <div className="mt-3">
                  <LineButton>💬 加 LINE 領「{v.village}選情健檢」</LineButton>
                </div>
              </div>
            </div>
          )}
        </Panel>

        {/* ── ② 台鳳里實戰案例 ── */}
        <Panel className="relative overflow-hidden">
          <SectionTag no="②" label="這不是紙上談兵——台鳳里，進行中" />
          <p className="mt-3 text-[14px] leading-relaxed text-ink">
            台鳳里的黃少綦，法律與運動藝術背景的素人，正用這套方法備戰 11/28。
            現任已連任三屆、上屆 1,339 票驚險過半——這一仗，東區每個里都在看。
          </p>
          {/* 一分鐘形象影片：連結到位後把下方占位框換成 <iframe> */}
          <div className="mt-4 flex aspect-video w-full flex-col items-center justify-center border-[3px] border-dashed border-ink/40 bg-ink/5">
            <span className="text-4xl">🎬</span>
            <p className="mt-2 font-serif text-sm font-black text-ink">一分鐘形象影片・即將上線</p>
            <p className="text-[11px] text-ink-soft">Start with WHY——先問為什麼，再談計畫</p>
          </div>
          <p className="mt-3 border-l-[3px] border-gold bg-paper px-3 py-2 text-[13px] leading-relaxed text-ink-soft">
            「一個人選，是孤軍；一群人挺，是計畫。」——COV 陪跑教練把選戰拆成每天做得到的事。
          </p>
        </Panel>

        {/* ── ③ 三題測驗 ── */}
        <Panel>
          <SectionTag no="③" label="測測你是哪種選民" />
          <p className="mt-2 text-[13px] text-ink-soft">3 題，30 秒，找出對你胃口的在地政見。</p>
          <div className="mt-4 space-y-5">
            {QUIZ.map((item, qi) => (
              <div key={qi}>
                <p className="font-serif text-[15px] font-black text-ink">Q{qi + 1}. {item.q}</p>
                <div className="mt-2 space-y-1.5">
                  {item.options.map((opt) => (
                    <button
                      key={opt.label}
                      onClick={() => setAnswers((prev) => prev.map((a, i) => (i === qi ? opt.type : a)))}
                      className={`block w-full cursor-pointer border-[2.5px] px-3 py-2 text-left text-[13px] font-medium transition-colors ${
                        answers[qi] === opt.type
                          ? 'border-campaign bg-campaign text-paper'
                          : 'border-ink/30 bg-white text-ink hover:border-ink'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {quizType && (
            <div className="mt-5 border-[3px] border-ink bg-paper p-4">
              <p className="font-serif text-2xl font-black text-ink">
                {QUIZ_RESULT[quizType].emoji} 你是「{QUIZ_RESULT[quizType].name}」
              </p>
              <p className="mt-2 text-[14px] leading-relaxed text-ink">{QUIZ_RESULT[quizType].desc}</p>
              <p className="mt-2 border-l-[3px] border-gold bg-white px-3 py-2 text-[13px] leading-relaxed text-ink-soft">
                {QUIZ_RESULT[quizType].policy}
              </p>
              <div className="mt-3">
                <LineButton>💬 把測驗結果傳給我們，聊聊你的里</LineButton>
              </div>
            </div>
          )}
        </Panel>

        {/* ── ④ 行動支持 ── */}
        <Panel className="bg-ink! text-paper">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center bg-gold font-serif text-sm font-black text-ink">④</span>
            <h2 className="font-serif text-xl font-black tracking-wide text-paper">用行動表態，不用等四年</h2>
          </div>
          <p className="mt-3 text-[14px] leading-relaxed text-paper/85">
            對地方政治不滿，但手上只有四年一次的那張票？很多里甚至同額競選、連票都沒得投。
            這裡給你第一個「現在就能做」的參與動作——
          </p>
          <div className="mt-4 grid gap-2">
            {[
              { emoji: '🪙', t: '小額贊助計畫', d: '資助 COV 陪跑計畫（計畫營收，非政治獻金）' },
              { emoji: '🙋', t: '報名志工', d: '週末掃街、活動支援，跟一群想改變的人站在一起' },
              { emoji: '💬', t: '留下你對里的建議', d: '你的一句話，可能就是下一條政見' },
            ].map((x) => (
              <a key={x.t} href={LINE_URL} target="_blank" rel="noreferrer" className="flex items-center gap-3 border-[2.5px] border-paper/50 px-3 py-2.5 transition-colors hover:border-gold-soft hover:bg-paper/5">
                <span className="text-2xl">{x.emoji}</span>
                <span>
                  <span className="block font-serif text-[15px] font-black text-paper">{x.t}</span>
                  <span className="block text-[11px] text-paper/70">{x.d}</span>
                </span>
              </a>
            ))}
          </div>
          <div className="mt-5 flex flex-col items-center border-t border-paper/30 pt-4">
            {qr && <img src={qr} alt="LINE QR Code" className="h-40 w-40 border-[3px] border-paper" />}
            <p className="mt-2 text-[12px] text-paper/70">掃碼或點上方任一選項，都會到同一個地方——我們的 LINE。</p>
          </div>
        </Panel>

        {/* ── ⑤ 智販機願景 ── */}
        <Panel>
          <SectionTag no="⑤" label="下一步：社區智販機" />
          <p className="mt-3 text-[14px] leading-relaxed text-ink">
            想像在你社區大樓、宮廟口或咖啡廳門邊，有一台「社區智慧服務節點」：
            平時輪播管委會公告、包裹提醒、防災資訊；選季販售
            <b>候選人聯名小物、在地青農產品、活動票券</b>——掃碼、付款、掉商品，三秒完成支持，
            等商品掉落的三秒鐘，螢幕正好播完一支一分鐘政見影片。
          </p>
          <ul className="mt-3 space-y-1 text-[13px] leading-relaxed text-ink-soft">
            <li>📍 場域優先：社區大樓、宮廟、在地店家——接觸「只是出門買杯咖啡」的普通里民，突破同溫層</li>
            <li>🖥️ MVP 做法：iPad＋落地立架，先進駐一個友善場域試營運</li>
            <li>📺 廣告版位：東區其他練習生的政見輪播——驗證版位販售的商業模式</li>
          </ul>
          <p className="mt-3 border-l-[3px] border-campaign bg-campaign/5 px-3 py-2 text-[12px] leading-relaxed text-ink-soft">
            💡 誠實說明：販售所得為 COV 計畫營收（支持陪跑服務營運），<b>不收受、不代收政治獻金</b>。
            想直接支持特定候選人的政治獻金，依法須由你本人捐入該候選人經監察院許可的專戶。
          </p>
          <div className="mt-3">
            <LineButton>🏢 想讓智販機進駐你的社區？聊聊</LineButton>
          </div>
        </Panel>

        {/* 免責 */}
        <footer className="space-y-1 px-1 text-center text-[11px] leading-relaxed text-ink-soft/70">
          <p>資料來源：中央選舉委員會選舉資料庫。保證金 NT$50,000 與退還門檻依 111 年地方公職選舉公告試算。</p>
          <p>本站為 COV 素人里長繁星計畫（民間陪跑計畫）所設，非任何候選人競選網站；估算僅供參考，不構成當選保證。</p>
          <p><a href="./" className="underline decoration-dotted">全臺 7,973 里完整版計算機 →</a></p>
        </footer>
      </div>
    </div>
  );
}
