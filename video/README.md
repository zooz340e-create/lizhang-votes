# 短影音產線

`config.json` + 素材 → **1080×1920 直式 MP4**（IG Reels / TikTok / YT Shorts）。

版面走專案同一套視覺（墨藍 × 競選紅 × 燙金 × 報紙米白），
所以影片跟網站看起來是同一個品牌。

```bash
cd video
npm install                                        # 第一次才要
node render.mjs projects/01-calculator/config.json
node render.mjs projects/01-calculator/config.json --preview 8   # 只算前 8 秒
```

輸出到 `video/out/`：影片 + 封面 JPG。30 秒約需 5 分鐘。

---

## 怎麼運作

三層疊起來，各自獨立所以好改：

1. **底層畫面** — 每顆鏡頭統一轉成 1080×1920 / 30fps 的片段再串接。
   影片會 cover 裁切，照片會自動加緩推鏡，`type: "card"` 則用瀏覽器畫出圖文卡。
2. **疊加層** — 字幕與動態圖文由 Chromium 逐格截圖，透明去背，
   直接 pipe 進 ffmpeg 合成（不落地成幾百張 PNG）。
   所有動畫都是「時間 t 的純函式」，所以每次算出來完全一樣。
3. **聲音** — 旁白做語音正規化，配樂自動閃避（sidechain ducking）到旁白之下，
   結尾淡出，最後過一道限幅器。

---

## config.json

```jsonc
{
  "slug": "01-calculator",          // 輸出檔名
  "title": "…", "fps": 30, "duration": 30,
  "coverAt": 3.6,                   // 封面取第幾秒

  "audio": {
    "voiceover": "media/vo.m4a",    // 沒有就留著，會自動略過
    "music": "media/bgm.mp3",
    "musicGain": 0.14               // 配樂音量（旁白之外的底噪感）
  },

  "shots": [                        // 依序排，總長 = 影片長度
    { "dur": 2.6, "src": "media/shot1.mp4", "in": 1.5 },   // in = 從原檔第幾秒開始
    { "dur": 3.0, "src": "media/a.jpg", "motion": "in" },  // in / out / none
    { "dur": 1.4, "type": "card", "variant": "campaign" }  // ink / campaign / paper
  ],

  "captions": [
    { "t": 0.15, "d": 2.3, "text": "第一行\n第二行，*這幾個字會變金色*" }
  ],

  "overlays": [
    { "type": "chip",  "t": 0.25, "d": 2.2, "x": 80, "y": 250, "text": "開票速報" },
    { "type": "stat",  "t": 3.0, "d": 2.9, "y": 600,
      "value": 36, "unit": "票", "label": "就能當里長" },   // 數字會跳動計數
    { "type": "title", "t": 10.0, "d": 2.8, "y": 700, "lines": ["差距", "*220 倍*"] },
    { "type": "rule",  "t": 3.3, "d": 2.6, "x": 420, "y": 1000, "w": 240 },
    { "type": "cta",   "t": 28.65, "d": 1.35, "y": 760,
      "headline": "你家的里\n要幾票？", "url": "lizhang-votes.vercel.app" }
  ]
}
```

**排版規則（已經內建，不用自己算）**
- 字幕貼齊底部往上長，行數變多也不會被 IG 介面蓋到。
- 實拍鏡頭和淺色卡的字幕底下會自動鋪漸層遮罩；深色圖文卡不鋪。
- 字幕一行約 13 個中文字，超過會自己折行 —— 想控制斷句就用 `\n`。

---

## 內容紀律

跟 README 的用詞紀律一致：**影片裡不出現真實里長姓名**，只用地名與數字。
數字一律從 `public/data/` 撈，不要手打。

---

## 環境

`npm install` 會裝好 Chromium 與含 H.264 的 ffmpeg。
字型（Noto Sans TC）放在 `.cache/fonts/`，沒有的話：

```bash
cd video && node setup.mjs
```
