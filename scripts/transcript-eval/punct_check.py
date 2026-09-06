#!/usr/bin/env python3
"""句読点の付き方を時間帯ごとに数える。

hotwords を入れたあと、Whisper の行が長くなって統合による読点の挿入が減り、30〜45 分が
読点なしのまま公開されたのに気づかなかった。CER も話者一致も監査も、読点の欠落には
反応しない。読み物として壊れているかは、これで見る。

    python3 punct_check.py transcript.json [transcript2.json …]
"""
import json, sys

BUCKET_SEC = 300
MIN_LINE_CHARS = 8

for path in sys.argv[1:]:
    segs = json.load(open(path))["segments"]
    buckets = {}
    for s in segs:
        text = s["text"].strip()
        if len(text) < MIN_LINE_CHARS:
            continue
        b = buckets.setdefault(int(s["start"] // BUCKET_SEC), [0, 0])
        b[0] += 1
        b[1] += 1 if ("、" in text or "。" in text) else 0
    worst = min((n and p / n) for n, p in buckets.values()) if buckets else 1.0
    print(f"== {path}: {len(segs)} 行、8 文字以上の行のうち句読点のある割合（5 分ごと）。最低 {worst:.0%}")
    print("   " + " ".join(f"{k*5:>3d}分" for k in sorted(buckets)))
    print("   " + " ".join(f"{(p / n if n else 1):>4.0%}" for k in sorted(buckets) for n, p in [buckets[k]]))
    # 各行が文として閉じているか（行末が 。！？ など）
    import re
    closed = re.compile(r"[。．！？!?」』）)…]\s*$")
    unclosed = [s for s in segs if s["text"].strip() and not closed.search(s["text"].strip())]
    print(f"   文として閉じていない行: {len(unclosed)} / {len(segs)} ({len(unclosed)/max(1,len(segs)):.0%})")
