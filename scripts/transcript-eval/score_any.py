import json, sys
sys.argv_ = list(sys.argv)
sys.argv=['x']
exec(open('score_local.py').read().split('def main')[0])
def all_at(spans, time):
    return {s.speaker for s in spans if s.start <= time < s.end and s.speaker}
def score_any(truth, ours, ranges):
    hit=both=0
    for rg in ranges:
        t=rg['start']
        while t<rg['end']:
            want=all_at(truth,t); got=all_at(ours,t)
            if want and got:
                both+=1
                gs=set(); [gs.update(g.split('・')) for g in got]; ws=set(); [ws.update(w.split('・')) for w in want]
                if gs & ws: hit+=1
            t+=FRAME_SEC
    return hit/both if both else 0
truth_data=json.load(open(sys.argv_[1])); ranges=truth_data['ranges']; truth=load(truth_data)
for name in sys.argv_[2:]:
    ours=load(json.load(open(name)))
    r=score_speakers(truth, ours, ranges)
    print(f"{name:34} strict {r.accuracy:6.1%}  any {score_any(truth, ours, ranges):6.1%}  missed {r.missed:5.1f}s extra {r.extra:4.1f}s")
