#!/usr/bin/env python3
"""生データの固有名詞の出現数と、3 秒以上の穴を出す。  python3 names_holes.py raw.json [raw2.json …]"""
import json, re, sys
KEYS=['藤原麻里菜','藤原まりな','真理奈','麻里奈','Image Cast','イメージキャスト','無駄づくり','無駄作り','つくるリハビリ','作るリハビリ','左右社','左右者','鉄道','魔王','中倉','米倉']
for path in sys.argv[1:]:
    d=json.load(open(path))['segments']; text=''.join(s['text'] for s in d)
    words=sorted((w['start'],w['end']) for s in d for w in (s.get('words') or [{'start':s['start'],'end':s['end']}]))
    gaps=[]; pe=0
    for a,b in words:
        if a-pe>=3.0: gaps.append((round(pe,1),round(a,1)))
        pe=max(pe,b)
    print(f"== {path}: {len(d)} segs, {len(text)} chars")
    print("  names:", {k: len(re.findall(k,text)) for k in KEYS})
    print(f"  holes>=3s: {len(gaps)} total {sum(b-a for a,b in gaps):.0f}s {gaps}")
