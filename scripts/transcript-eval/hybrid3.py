#!/usr/bin/env python3
"""現行の生データ（音量で話者分離済み）の各セグメントについて、話者だけを
トラック別文字起こしとの内容照合で決め直す。決められないものは元のまま。
あわせて、ミックスで落ちた発話をトラック側から補う。

    python3 hybrid2.py mix_raw.json pertrack_resplit.json levels.json out.json [--no-recover] [--report]
"""
import base64, json, re, sys
from difflib import SequenceMatcher

PUNCT = re.compile(r"[\s、。，．,\.!?！？「」『』（）()…～〜\"'・:：;；\-—–]")
WINDOW_PAD = 0.45
MATCH_MIN = 0.6
MATCH_MARGIN = 0.25
JOINT_MIN = 0.75
RECOVER_MAX_COVERED = 0.4
RECOVER_MIN_CHARS = 4
RECOVER_MIN_DOMINANCE = 0.3
NOISE = re.compile(r"^(うん|はい|そう|ええ|へえ|へー|ああ|あー|なるほど|ふん|ふーん|はあ|ほう|うーん|いや|まあ|おお|おー|笑|ん|え|あ|は|ふ|わ|う|お)+$")

def kana_fold(t):
    return ''.join(chr(ord(c) - 0x60) if 'ァ' <= c <= 'ヶ' else c for c in t)
def bare(t): return kana_fold(PUNCT.sub("", t))
def coverage(target, pool):
    a, b = bare(target), bare(pool)
    if not a or not b: return 0.0
    sm = SequenceMatcher(None, a, b, autojunk=False)
    return sum(bl.size for bl in sm.get_matching_blocks()) / len(a)
def load_levels(path):
    d = json.load(open(path)); return d["frameSec"], {k: list(base64.b64decode(v)) for k, v in d["tracks"].items()}
def dominance(levels, fs, label, start, end):
    a = int(start / fs); b = max(a + 1, int(end / fs)); top_n = voiced = 0
    for i in range(a, b):
        vals = {k: (v[i] if i < len(v) else 0) for k, v in levels.items()}; top = max(vals.values())
        if top > 0:
            voiced += 1
            if vals.get(label, 0) >= top: top_n += 1
    return top_n / voiced if voiced else 0.0

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    report = '--report' in sys.argv; recover = '--no-recover' not in sys.argv
    mix = json.load(open(args[0])); tracks = json.load(open(args[1])); fs, levels = load_levels(args[2])
    order = list(levels.keys())
    track_words = {}
    for s in tracks["segments"]:
        for w in s.get("words") or []:
            track_words.setdefault(s["speaker"], []).append((( w["start"] + w["end"]) / 2, w["text"]))
    for v in track_words.values(): v.sort()
    def track_text(L, start, end):
        return ''.join(t for m, t in track_words.get(L, []) if start - WINDOW_PAD <= m <= end + WINDOW_PAD)

    out = []; changed = []; stats = {"kept": 0, "relabeled": 0, "joint": 0, "confirmed": 0}
    for s in mix["segments"]:
        text = s["text"]; start, end = s["start"], s["end"]
        scores = {L: coverage(text, track_text(L, start, end)) for L in track_words}
        ranked = sorted(scores.items(), key=lambda kv: -kv[1])
        joint = [L for L, sc in ranked if sc >= JOINT_MIN]
        new = s.get("speaker"); how = "kept"
        if len(joint) >= 2 and len(bare(text)) <= 12 and len(bare(text)) >= 2:
            new = "・".join(sorted(joint, key=order.index)); how = "joint"
        elif ranked and ranked[0][1] >= MATCH_MIN and (len(ranked) == 1 or ranked[0][1] - ranked[1][1] >= MATCH_MARGIN) and len(bare(text)) >= 2:
            new = ranked[0][0]; how = "relabeled" if new != s.get("speaker") else "confirmed"
        stats[how] += 1
        seg = dict(s); seg["speaker"] = new; seg["how"] = how; seg["scores"] = {k: round(v, 2) for k, v in scores.items()}
        if how == "relabeled": changed.append((s, new, scores))
        out.append(seg)

    recovered = []
    if recover:
        TIGHT = 0.15
        mix_units = [(s["start"], s["end"], s.get("speaker") or "", s.get("words") or []) for s in mix["segments"]]
        def mix_words_in(start, end, pad):
            return ''.join(w["text"] for _, _, _, ws in mix_units for w in ws if start - pad <= (w["start"] + w["end"]) / 2 <= end + pad)
        def mix_speakers_in(start, end, pad):
            out = set()
            for a, b, sp, _ in mix_units:
                if a < end + pad and b > start - pad and sp: out.update(sp.split("・"))
            return out
        for s in tracks["segments"]:
            t = s["text"]; b = bare(t); L = s["speaker"]
            if len(b) < RECOVER_MIN_CHARS or NOISE.match(b) or re.match(r"^う?[はふ]{2,}", b): continue
            dom = dominance(levels, fs, L, s["start"], s["end"])
            if dom < 0.4: continue
            tight_any = coverage(t, mix_words_in(s["start"], s["end"], TIGHT))
            why = None
            if tight_any < 0.6:
                # ミックスにほぼ無い → 落ちている（穴・被り負け）
                if coverage(t, mix_words_in(s["start"], s["end"], WINDOW_PAD)) <= RECOVER_MAX_COVERED:
                    why = "missing"
            else:
                # ミックスにはある。誰のものになっているか
                attributed = mix_speakers_in(s["start"], s["end"], TIGHT)
                if L not in attributed and attributed:
                    # 相手のトラックにも同じ言葉があるなら、二人とも言っている
                    if any(coverage(t, track_text(M, s["start"], s["end"])) >= 0.6 for M in attributed if M in track_words):
                        why = "both-said"
            if not why: continue
            recovered.append({"start": s["start"], "end": s["end"], "text": t, "speaker": L, "words": s.get("words"),
                              "how": "recovered", "why": why, "scores": {"covered": round(tight_any, 2), "dominance": round(dom, 2)}})
    out.extend(recovered)
    out.sort(key=lambda s: s["start"])
    json.dump({"segments": out, "language": "ja"}, open(args[3], "w"), ensure_ascii=False)
    print(f"hybrid2: {stats}; recovered {len(recovered)}")
    if report:
        print("--- relabeled")
        for s, new, sc in changed[:40]:
            print(f"  {s['start']:8.2f}-{s['end']:8.2f} {str(s.get('speaker')):6} -> {new:6} {s['text'][:36]!r} { {k: round(v,2) for k,v in sc.items()} }")
        print("--- recovered")
        for r in recovered[:40]:
            print(f"  + {r['start']:8.2f}-{r['end']:8.2f} {r['speaker']:6} {r['why']:9} cov={r['scores']['covered']} dom={r['scores']['dominance']} {r['text'][:50]!r}")
main()
