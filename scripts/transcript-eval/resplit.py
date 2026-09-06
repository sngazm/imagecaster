#!/usr/bin/env python3
"""単語の時刻でセグメントを切り直す。

vad_filter で無音を詰めて認識すると、Whisper のセグメント時刻は詰めた前後に
またがって 30 秒を超えることがある。単語の時刻は正しく戻されているので、
単語の間が空いたところ（と、句点のあと）で切り直す。

    python3 resplit.py in.json out.json [--gap 0.6]
"""
import json, sys
GAP = float(sys.argv[sys.argv.index('--gap')+1]) if '--gap' in sys.argv else 0.6
SENT_END = "。！？!?"
src = json.load(open(sys.argv[1]))
out = []
for s in src["segments"]:
    words = s.get("words") or []
    if not words:
        out.append(s); continue
    groups = [[words[0]]]
    for prev, w in zip(words, words[1:]):
        gap = w["start"] - prev["end"]
        if gap > GAP or (gap > 0.25 and prev["text"].strip()[-1:] in SENT_END):
            groups.append([w])
        else:
            groups[-1].append(w)
    for g in groups:
        text = ''.join(w["text"] for w in g).strip()
        if not text: continue
        seg = {k: v for k, v in s.items() if k not in ("start", "end", "text", "words")}
        seg.update({"start": g[0]["start"], "end": g[-1]["end"], "text": text, "words": g})
        out.append(seg)
out.sort(key=lambda s: s["start"])
json.dump({"segments": out, "language": src.get("language", "ja")}, open(sys.argv[2], "w"), ensure_ascii=False)
print(f"resplit: {len(src['segments'])} -> {len(out)} segments (gap>{GAP}s)")
