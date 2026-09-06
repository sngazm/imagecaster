#!/usr/bin/env python3
"""公開された生データのうち、ミックス単体の本文（ログから復元）に無い発話を列挙する。
    python3 classify_recovered.py raw.json mix_from_log.json levels.json
"""
import base64, json, re, sys
from difflib import SequenceMatcher
PUNCT = re.compile(r"[\s、。，．,\.!?！？「」『』（）()…～〜\"'・:：;；\-—–]")
def fold(t): return ''.join(chr(ord(c)-0x60) if 'ァ'<=c<='ヶ' else c for c in t)
def bare(t): return fold(PUNCT.sub('', t))
def cov(a,b):
    a,b=bare(a),bare(b)
    if not a or not b: return 0.0
    return sum(x.size for x in SequenceMatcher(None,a,b,autojunk=False).get_matching_blocks())/len(a)
raw=json.load(open(sys.argv[1]))['segments']; mix=json.load(open(sys.argv[2])); L=json.load(open(sys.argv[3]))
fs=L['frameSec']; lv={k: list(base64.b64decode(v)) for k,v in L['tracks'].items()}
for i,m in enumerate(mix): m['end']=mix[i+1]['start'] if i+1<len(mix) else m['start']+30
def dom(label,s,e):
    a=int(s/fs); b=max(a+1,int(e/fs)); top_n=voiced=0
    for i in range(a,b):
        vals={k:(v[i] if i<len(v) else 0) for k,v in lv.items()}; top=max(vals.values())
        if top>0:
            voiced+=1
            if vals.get(label,0)>=top: top_n+=1
    return top_n/voiced if voiced else 0
rec=[]
for s in raw:
    if len(bare(s['text']))<4: continue
    pool=''.join(m['text'] for m in mix if m['start']<s['end']+1.0 and m['end']>s['start']-1.0)
    c=cov(s['text'],pool)
    if c<0.5: rec.append((s,c))
tot=sum(s['end']-s['start'] for s,_ in rec); chars=sum(len(s['text']) for s,_ in rec)
print(f"segments not in mix-only text: {len(rec)} ({tot:.0f}s, {chars} chars)")
for s,c in rec:
    print(f"  {s['start']:8.2f}-{s['end']:8.2f} {str(s.get('speaker')):8} dom={dom(s.get('speaker') or '',s['start'],s['end']):.2f} cov={c:.2f} {s['text'][:60]!r}")
