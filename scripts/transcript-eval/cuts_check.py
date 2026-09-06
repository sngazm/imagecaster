#!/usr/bin/env python3
"""話者の切れ目が文の途中に落ちている箇所を数える。
隣り合う別話者のセグメントで、左が句読点で終わらず、間が 0.2 秒未満のもの。
    python3 cuts_check.py raw.json [raw2.json …]
"""
import json, re, sys
END = re.compile(r"[。．、，,！？!?…」』）)]\s*$")
for path in sys.argv[1:]:
    segs=sorted(json.load(open(path))['segments'], key=lambda s: s['start'])
    cuts=[]; changes=0
    for a,b in zip(segs, segs[1:]):
        if a.get('speaker')==b.get('speaker'): continue
        changes+=1
        gap=b['start']-a['end']
        if gap<0.2 and not END.search(a['text'].strip()):
            cuts.append((a,b))
    short=[c for c in cuts if min(len(c[0]['text']),len(c[1]['text']))<=4]
    print(f"== {path}: 話者交代 {changes} 箇所、うち文の途中で切れている {len(cuts)} ({len(cuts)/max(1,changes):.0%})、片側が 4 文字以下 {len(short)}")
    for a,b in cuts[:8]:
        print(f"   {a['start']:8.2f} {str(a.get('speaker'))[:6]:6} {a['text'][-18:]!r} | {str(b.get('speaker'))[:6]:6} {b['text'][:18]!r}")
