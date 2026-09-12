#!/usr/bin/env python3
"""正解と突き合わせて、句読点の付き方の違いを数える。

本文（句読点・空白を除いた文字列）を並べて対応を取り、同じ文字の直後に
正解は何を打っているか／こちらは何を打っているかを比べる。話者や CER には映らない、
「一文がやたら長い」「句点が足りない」を数字にする。

    python3 punct_diff.py truth.json ours.json [--detail]
"""
import json, re, sys, unicodedata
from collections import Counter
from difflib import SequenceMatcher

MARKS = "、。，．,!?！？…"
STRIP = re.compile(r"[\s「」『』（）()・:：;；\-—–\"']")

def marked(segments, ranges):
    """(文字, 直後の記号) の列。範囲に中点が入るセグメントを時刻順に。"""
    out = []
    for s in sorted(segments, key=lambda s: s["start"]):
        mid = (s["start"] + s["end"]) / 2
        if not any(r["start"] <= mid <= r["end"] for r in ranges):
            continue
        # NFKC は「…」を "..." にするので、先に戻す。「...」も「…」として扱う
        text = unicodedata.normalize("NFKC", STRIP.sub("", s["text"])).replace("...", "…")
        for ch in text:
            if ch in MARKS or ch in "、。":
                if out:
                    out[-1][1] += ch
            else:
                out.append([ch, ""])
        # 行の終わりは、記号が無くても切れ目。「|」で表す
        if out:
            out[-1][1] += "|"
    return out

def kind(marks):
    if "。" in marks or "！" in marks or "？" in marks or "!" in marks or "?" in marks: return "。"
    if "…" in marks: return "…"
    if "、" in marks or "," in marks: return "、"
    if "|" in marks: return "|"
    return ""

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    detail = "--detail" in sys.argv
    truth = json.load(open(args[0])); ours = json.load(open(args[1]))
    ranges = truth["ranges"]
    a = marked(truth["segments"], ranges); b = marked(ours["segments"], ranges)
    sa = "".join(c for c, _ in a); sb = "".join(c for c, _ in b)
    m = SequenceMatcher(None, sa, sb, autojunk=False)
    pairs = Counter(); examples = {}
    for block in m.get_matching_blocks():
        for k in range(block.size):
            ka, kb = kind(a[block.a + k][1]), kind(b[block.b + k][1])
            if ka or kb:
                key = (ka or "無", kb or "無")
                pairs[key] += 1
                if detail and ka != kb and len(examples.setdefault(key, [])) < 6:
                    ctx = sa[max(0, block.a + k - 10): block.a + k + 1] + "‖" + sa[block.a + k + 1: block.a + k + 8]
                    examples[key].append(ctx)
    total_truth = sum(v for (ka, _), v in pairs.items() if ka != "無")
    print(f"正解の区切り {total_truth} 箇所（。/…/、/行末）")
    print("正解→こちら   件数")
    for (ka, kb), v in sorted(pairs.items(), key=lambda kv: -kv[1]):
        mark = "  " if ka == kb else "×"
        print(f"  {mark} {ka} → {kb}   {v}")
    agree = sum(v for (ka, kb), v in pairs.items() if ka == kb)
    print(f"一致 {agree} / {sum(pairs.values())} = {agree / max(1, sum(pairs.values())):.0%}")
    if detail:
        for key, exs in examples.items():
            print(f"\n{key[0]} → {key[1]}")
            for e in exs: print("   ", e)

main()
