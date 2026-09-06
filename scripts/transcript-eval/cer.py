#!/usr/bin/env python3
"""正解（truth）と比べて本文の文字誤り率（CER）を出す。

確かめた範囲だけ見る。範囲に中点が入るセグメントを時刻順に連結し、
記号・空白を落として文字単位の編集距離を取る。

    python3 cer.py 281/transcript.truth.json 281/transcript.raw.json [--detail] [--strip-fillers]
"""
import json, re, sys, unicodedata

PUNCT = re.compile(r"[\s、。，．,\.!?！？「」『』（）()…～〜\"'・:：;；\-—–]")

FILLERS = ["なんか", "えー", "えーと", "えっと", "あの", "あのー", "まあ", "その", "うーん", "うん", "はい", "あー", "んー", "ね", "まー"]

WORKER_FILLERS = ["えーと", "ええと", "えっと", "えと", "えー", "あのー", "あのう", "あーの", "あの",
    "そのー", "その", "まあ", "まー", "まぁ", "なんていうか", "なんつうか", "なんか", "こう", "こー", "ほら",
    "うーんと", "んー"]

def norm(text, strip_fillers=False):
    t = unicodedata.normalize("NFKC", text)
    t = PUNCT.sub("", t)
    if strip_fillers:
        for f in WORKER_FILLERS:
            t = t.replace(f, "")
    return t

def in_range(seg, rg):
    mid = (seg["start"] + seg["end"]) / 2
    return rg["start"] <= mid <= rg["end"]

def collect(data, rg):
    return sorted([s for s in data["segments"] if in_range(s, rg)], key=lambda s: s["start"])

def effective_range(truth, rg):
    segs = collect(truth, rg)
    if not segs: return rg
    return {"start": min(s["start"] for s in segs), "end": max(s["end"] for s in segs)}

def collect_text(data, rg):
    """単語時刻があれば単語の中点で切り、全体を時刻順に並べる。統合された長い行が端で丸ごと落ちるのを防ぐ。"""
    timed = []
    parts = []
    for s in sorted(data["segments"], key=lambda s: s["start"]):
        words = s.get("words") or []
        covered = PUNCT.sub("", ''.join(w["text"] for w in words)) == PUNCT.sub("", s["text"])
        if words and covered:
            for w in words:
                mid = (w["start"] + w["end"]) / 2
                if rg["start"] <= mid <= rg["end"]:
                    timed.append((mid, w["text"]))
        elif s["end"] > rg["start"] and s["start"] < rg["end"]:
            text = s["text"]; n = max(1, len(text)); span = s["end"] - s["start"]
            for i, ch in enumerate(text):
                at = s["start"] + span * (i + 0.5) / n
                if rg["start"] <= at <= rg["end"]:
                    timed.append((at, ch))
    timed.sort(key=lambda x: x[0])
    return ''.join(t for _, t in timed)

def levenshtein_ops(a, b):
    """a→b の編集操作を返す。返り値: (距離, ops) ops は ('=', ca, cb) / ('S', ca, cb) / ('D', ca, '') / ('I', '', cb)"""
    n, m = len(a), len(b)
    dp = [[0]*(m+1) for _ in range(n+1)]
    for i in range(1, n+1): dp[i][0] = i
    for j in range(1, m+1): dp[0][j] = j
    for i in range(1, n+1):
        ai = a[i-1]
        row = dp[i]; prev = dp[i-1]
        for j in range(1, m+1):
            cost = 0 if ai == b[j-1] else 1
            row[j] = min(prev[j] + 1, row[j-1] + 1, prev[j-1] + cost)
    ops = []
    i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and dp[i][j] == dp[i-1][j-1] + (0 if a[i-1] == b[j-1] else 1):
            ops.append(('=' if a[i-1] == b[j-1] else 'S', a[i-1], b[j-1])); i -= 1; j -= 1
        elif i > 0 and dp[i][j] == dp[i-1][j] + 1:
            ops.append(('D', a[i-1], '')); i -= 1
        else:
            ops.append(('I', '', b[j-1])); j -= 1
    ops.reverse()
    return dp[n][m], ops

def group_ops(ops, ctx=6):
    """連続した誤りをまとめて、前後の文脈付きで出す。"""
    out = []
    i = 0
    while i < len(ops):
        if ops[i][0] == '=':
            i += 1; continue
        j = i
        while j < len(ops) and ops[j][0] != '=': j += 1
        # 誤りの塊 ops[i:j]
        before = ''.join(o[1] for o in ops[max(0, i-ctx):i])
        after = ''.join(o[1] for o in ops[j:j+ctx])
        want = ''.join(o[1] for o in ops[i:j])
        got = ''.join(o[2] for o in ops[i:j])
        kinds = ''.join(o[0] for o in ops[i:j])
        out.append((before, want, got, after, kinds))
        i = j
    return out

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    detail = '--detail' in sys.argv
    strip = '--strip-fillers' in sys.argv
    truth = json.load(open(args[0]))
    ours = json.load(open(args[1]))
    ranges = truth["ranges"]
    total_ref = total_dist = 0
    S = D = I = 0
    all_groups = []
    for k, rg in enumerate(ranges):
        eff = effective_range(truth, rg)
        ref = norm(''.join(s["text"] for s in collect(truth, rg)), strip)
        hyp = norm(collect_text(ours, eff), strip)
        dist, ops = levenshtein_ops(ref, hyp)
        s = sum(1 for o in ops if o[0] == 'S'); d = sum(1 for o in ops if o[0] == 'D'); ins = sum(1 for o in ops if o[0] == 'I')
        S += s; D += d; I += ins
        total_ref += len(ref); total_dist += dist
        print(f"range {k} [{rg['start']:.1f}-{rg['end']:.1f}] ref {len(ref)} chars  hyp {len(hyp)}  dist {dist}  CER {dist/len(ref):.1%}  (S{s} D{d} I{ins})")
        if detail:
            for before, want, got, after, kinds in group_ops(ops):
                all_groups.append((k, before, want, got, after, kinds))
    print(f"TOTAL ref {total_ref} chars  dist {total_dist}  CER {total_dist/total_ref:.2%}  accuracy {1-total_dist/total_ref:.2%}   S{S} D{D} I{I}")
    if detail:
        print()
        for k, before, want, got, after, kinds in all_groups:
            print(f"  r{k} …{before}[{want} → {got}]{after}…   ({kinds})")

main()
