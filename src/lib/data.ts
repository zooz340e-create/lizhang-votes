// 資料載入層 — 按需載入（lazy load）+ 記憶體快取
//
// 全臺 7,000+ 個里的完整資料約 6MB，不能打包進 bundle（首屏會慢到沒人等）。
// 改成：首屏只抓 index.json（縣市清單，約 2KB），使用者選了縣市才抓該縣市的資料檔。
// 抓過的縣市留在記憶體快取，切換回來不重抓。

import type { Village } from './calc';

export interface VillageRow extends Village {
  county: string;
  district: string;
}

export interface CountyInfo {
  code: string; // 例：臺中市 66000、彰化縣 10007
  name: string;
  villages: number;
}

export interface DataIndex {
  meta: {
    scope: string;
    election_source: string;
    electorate_note: string;
    generated_at?: string;
  };
  counties: CountyInfo[];
}

const base = import.meta.env.BASE_URL || '/';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${base}data/${path}`);
  if (!res.ok) throw new Error(`資料載入失敗（HTTP ${res.status}）`);
  return res.json();
}

let indexPromise: Promise<DataIndex> | undefined;
export function loadIndex(): Promise<DataIndex> {
  // 快取 Promise 而非結果：同時多次呼叫也只發一次請求
  return (indexPromise ??= getJson<DataIndex>('index.json'));
}

const countyCache = new Map<string, Promise<VillageRow[]>>();
export function loadCounty(code: string): Promise<VillageRow[]> {
  let p = countyCache.get(code);
  if (!p) {
    p = getJson<{ villages: VillageRow[] }>(`county/${code}.json`).then((d) => d.villages);
    // 載入失敗就從快取移除，讓使用者重選時能重試
    p.catch(() => countyCache.delete(code));
    countyCache.set(code, p);
  }
  return p;
}
