// VoteMatch 共用型別：里長候選人卡片資料
//
// 資料只來自兩種來源：①選委會候選人登記冊／概況表（名字、里、黨、登記序號）
// ②候選人公開頁面或本人提供的素材（照片、政見、文案）。其餘一律留空。
// 登記序號 ≠ 號次；登記 ≠ 審定。

export type Party = 'KMT' | 'DPP' | 'TPP' | 'NPP' | 'IND' | 'OTHER';

export const PARTY_LABEL: Record<Party, string> = {
  KMT: '中國國民黨',
  DPP: '民主進步黨',
  TPP: '台灣民眾黨',
  NPP: '時代力量',
  IND: '無黨籍',
  OTHER: '其他政黨',
};

export interface Cand {
  id: string;
  county: string; // 臺北市／彰化縣
  town: string; // 大安區／彰化市／鹿港鎮…
  village: string; // 含「里」或「村」字
  name: string;
  regNo: number; // 登記序號（非號次）
  party: Party;
  partyLabel?: string; // party 為 OTHER 時的原始黨名
  gender?: '男' | '女';
  note?: string; // 登記冊備註欄
  // ── 候選人自行提供／公開頁面資料，缺者留空 ──
  nick?: string;
  front?: string; // 正面照片 /votematch/*.jpg
  avatar?: string;
  titles?: string;
  tagline?: string;
  slogans?: string[];
  background?: string;
  tags?: string[];
  source?: string;
}

export function partyLabel(c: Pick<Cand, 'party' | 'partyLabel'>): string {
  return c.party === 'OTHER' && c.partyLabel ? c.partyLabel : PARTY_LABEL[c.party];
}
