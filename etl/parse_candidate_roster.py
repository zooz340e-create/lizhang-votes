#!/usr/bin/env python3
"""選委會「村里長選舉候選人登記概況表」PDF → src/lib/<name>2026.ts

用法：pdftotext -layout 概況表.pdf roster.txt && python3 etl/parse_candidate_roster.py roster.txt 彰化縣 src/lib/changhua2026.ts CHANGHUA
欄位：選舉區 登記日期 姓名 性別 推薦之政黨 登記序號 [備註]
注意：登記序號≠號次；登記≠審定。
"""
import re, sys, json, collections
src, county, out, prefix = sys.argv[1:5]
PARTY = {'無':'IND','中國國民黨':'KMT','民主進步黨':'DPP','台灣民眾黨':'TPP','臺灣民眾黨':'TPP','時代力量':'NPP'}
pat = re.compile(r'^\s*' + re.escape(county) + r'(\S+?[鄉鎮市])(\S+?[里村])\s+(\d{3}/\d{2}/\d{2})\s+(\S+)\s+([男女])\s+(\S+)\s+(\d+)(?:\s+(\S.*?))?\s*$')
rows, bad, meta = [], [], {}
towns = []
for line in open(src, encoding='utf-8'):
    m = pat.match(line)
    if m:
        town, village, date, name, gender, party, regno, note = m.groups()
        if town not in towns: towns.append(town)
        rows.append({'id': f'{town}-{village}-{name}', 'county': county, 'town': town, 'village': village,
                     'name': name, 'gender': gender, 'party': PARTY.get(party, 'OTHER'),
                     **({'partyLabel': party} if party not in PARTY else {}),
                     'regNo': int(regno), **({'note': note} if note else {})})
    else:
        s = line.strip()
        if s.startswith(county): bad.append(s)
        mm = re.search(r'製表日期：(\S+)\s+列印筆數：(\d+)', s)
        if mm: meta['compiledAt'], meta['printed'] = mm.group(1), int(mm.group(2))
per_town = collections.Counter(r['town'] for r in rows)
parties = collections.Counter(r['party'] for r in rows)
def ts(v): return json.dumps(v, ensure_ascii=False)
lines = ['// 由 etl/parse_candidate_roster.py 產生，請勿手改。',
         f'// 來源：{county}選舉委員會「115年村里長選舉候選人登記概況表」（製表 {meta.get("compiledAt","?")}，列印筆數 {meta.get("printed","?")}）。',
         '// 登記序號 ≠ 號次；登記 ≠ 審定，正式候選人以選委會公告為準。',
         "import type { Cand } from './candidates';", '',
         f'export const {prefix}_META = {{ county: {ts(county)}, compiledAt: {ts(meta.get("compiledAt",""))}, printed: {meta.get("printed",0)}, parsed: {len(rows)}, source: {ts(county + "選舉委員會 候選人登記概況表")} }};',
         f'export const {prefix}_TOWNS: string[] = {ts(towns)};',
         f'export const {prefix}_2026: Cand[] = [']
for r in rows: lines.append('  ' + ts(r) + ',')
lines.append('];'); lines.append('')
open(out, 'w', encoding='utf-8').write('\n'.join(lines))
print(f'parsed={len(rows)} printed={meta.get("printed")} towns={len(towns)} unparsed={len(bad)}')
print('parties', dict(parties)); print('per_town', dict(per_town))
for b in bad[:10]: print('UNPARSED:', b)
