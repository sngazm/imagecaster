#!/usr/bin/env python3
"""正解の各行について、候補ファイルそれぞれが何と言っているかを並べる。
   compare.py truth.json a.json b.json ...   [--all]  (既定は食い違いのある行だけ)
話者一致は「正解行の時間のうち、候補の各話者が占める割合」で見る（単語があれば単語の中点で）。
"""
import json, sys
args=[a for a in sys.argv[1:] if not a.startswith('--')]; show_all='--all' in sys.argv
truth=json.load(open(args[0])); cands={p.split('/')[-1].replace('.json',''):json.load(open(p)) for p in args[1:]}
def units(data):
    out=[]
    for s in data['segments']:
        ws=s.get('words') or []
        if ws:
            for w in ws: out.append(((w['start']+w['end'])/2, s.get('speaker'), w['text']))
        else:
            n=max(1,len(s['text'])); span=s['end']-s['start']
            for i,ch in enumerate(s['text']): out.append((s['start']+span*(i+.5)/n, s.get('speaker'), ch))
    return sorted(out)
U={k:units(v) for k,v in cands.items()}
def within(u,a,b): return [x for x in u if a<=x[0]<b]
bad=0
for t in truth['segments']:
    rows=[]; mismatch=False
    for k,u in U.items():
        got=within(u,t['start'],t['end'])
        by={}
        for _,sp,tx in got: by.setdefault(sp,[]).append(tx)
        main=max(by,key=lambda k:len(''.join(by[k]))) if by else None
        txt=''.join(tx for _,sp,tx in got)
        ok = main==t.get('speaker') or (main and t.get('speaker') and set(str(main).split('・'))&set(str(t.get('speaker')).split('・')))
        if not ok: mismatch=True
        rows.append(f"    {k:14} {'  ' if ok else '×'} {str(main):6} {txt[:60]}" + (f"   [{', '.join(f'{sp}:{len(''.join(v))}' for sp,v in by.items())}]" if len(by)>1 else ''))
    if mismatch or show_all:
        bad+=mismatch
        print(f"{t['start']:7.2f}-{t['end']:7.2f} 正解 {t.get('speaker'):6} {t['text'][:60]}")
        print('\n'.join(rows))
print(f"\n食い違う正解行: {bad} / {len(truth['segments'])}")
