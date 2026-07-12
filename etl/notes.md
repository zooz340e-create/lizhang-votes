# ETL 筆記 — 資料怎麼撈進來的

> 資料是在 Claude session 裡用 Twinkle Hub MCP（本機工具）撈出來、手動落地成 `src/data/daya.json`。
> 網站上線後不連 Twinkle Hub。要更新或擴大，照下面重跑。

## 1. 人口 / 選舉人數（戶政司 dataset 77132）

確認某區有哪些月份、幾個里：
```
query_rows("77132",
  columns=['統計年月','COUNT(*) AS n'],
  where='"區域別" ILIKE \'%大雅%\'',
  group_by=['統計年月'], order_by='"統計年月" DESC')
```
（目前 Twinkle 正規化版只有 10911 = 2020-11 一個月。要更新月份改抓 ris.gov.tw 即時 API：
`https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP014/<民國年月>`）

撈各里人口 + 選舉人數推估（= 總人口 − 0~19 歲男女加總）：
```
query_rows("77132",
  columns=['"區域別代碼"','"村里"','"人口數"',
    'CAST("人口數" AS INT) - (CAST("0歲-男" AS INT)+...+CAST("19歲-女" AS INT)) AS pop_eligible_est'],
  where='"區域別" ILIKE \'%大雅%\' AND "統計年月"=\'10911\'',
  order_by='"區域別代碼"')
```
（完整 0~19 歲共 40 個 CAST 欄位；20 歲為投票年齡，故扣 0~19。）

大雅區結果已落地於 `src/data/daya.json`（西寶里：人口 5846 / 選舉人數推估 4627 / 門檻 463）。

## 2. 歷屆里長得票（中選會）— ✅ 已自動化（擴台關鍵）

中選會選舉資料庫（db.cec.gov.tw）前端讀的是**公開靜態 JSON**，免登入、結構穩定，
比解析 votedata.zip 省事太多。`etl/fetch_elections.mjs` 就是打這條：

**各屆 themeId**（從 `https://db.cec.gov.tw/static/elections/list/ELC_V0.json` 取得）：
- 2022 第4屆：`0bd11a4b3f092aae2811741428ec3e3d`
- 2018 第3屆：`80325f73197f1d752b987778c725d20d`
- 2014 第2屆：`f29f60196b2b39ef6ac298106f927738`

**兩個資料檔**（檔名 = `<prv>_<city>_<area>_<dept>_<li>.json`；臺中市 prv=66）：
- 候選人得票：`.../static/elections/data/tickets/ELC/V0/00/<themeId>/L/66_000_00_000_0000.json`
  → 每候選人一筆：`area_name`(里)、`ticket_num`(得票)、`ticket_percent`、`is_victor`("*"=當選)、
    `cand_name`、`is_current`(Y=現任)、`li_code`。整檔含該縣市所有里，依 `dept_code` 篩區（大雅=180）。
- 選舉概況：`.../static/elections/data/profiles/ELC/V0/00/<themeId>/L/66_000_00_000_0000.json`
  → 每里一筆：`votable_population`(選舉人數)、`vote_to_elect`(投票率%)、`valid_ticket`(有效票)、
    `invalid_ticket`、`cand_num`(候選人數，=1 即同額)、`elected_num`(應選=1)。

**擴台做法**：✅ 已完成（2026-07-12）。`etl/fetch_all.mjs` 從
`.../areas/ELC/V0/00/<themeId>/C/00_000_00_000_0000.json` 動態抓 22 縣市清單，
迴圈跑全臺，輸出 `public/data/index.json` + `public/data/county/<code>.json`（前端按需載入）。

> 備援來源：各區公所零散開放資料（如高雄鳥松區 Twinkle dataset `166436`），覆蓋不齊，僅 fallback。

## 待核對的法律常數

- 里長保證金：歷年 NT$5,000（以中選會各次選舉公告為準）。
- 退還門檻：選舉人數 × 10%（應選名額 1）。
- 同額競選當選門檻：另查《選罷法》第 70 條相關規定（MVP 多為競爭選舉，影響小）。
