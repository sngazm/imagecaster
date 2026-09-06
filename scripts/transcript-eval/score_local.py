#!/usr/bin/env python
"""話者分離の出力を、人が直した正解と突き合わせて点を出す。

推測でロジックを積み上げるのをやめるために作った。変更の前後でこの数字が
上下したかを見れば、直ったのか壊したのかが分かる。

**確かめた範囲だけ**を見る。まだ見ていない箇所の食い違いを間違いとして
数えると、点が意味を持たない。

    python scripts/score.py 281
    python scripts/score.py 281 --detail   # どこで落としているかを出す
"""

import argparse
import json
import sys
import urllib.request
from collections import Counter
from dataclasses import dataclass

#: 秒単位で数えるときの刻み
FRAME_SEC = 0.05

#: 境界が合っているとみなす差
BOUNDARY_TOLERANCE_SEC = 0.3

#: これより短い空きは、発言が落ちているのではなく境界の取り方の差とみなす。
#:
#: 正解は人が連続して引くが、こちらは Whisper の単語時刻なので隙間が空く。
#: 0.16 秒の空きを「取りこぼし」と数えると、本文は両方にあるのに欠落として
#: 上がってきて、直す場所を見誤る。
MIN_MISS_SEC = 0.4

BUCKET = "https://cast-bucket.image.club"


def fetch(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": "score.py"})
    return json.loads(urllib.request.urlopen(request).read())


def storage_key(episode: str) -> str:
    index = fetch(f"{BUCKET}/index.json")
    for item in index.get("episodes", []):
        if str(item.get("id")) == episode or item.get("slug") == episode:
            return item["storageKey"]
    raise SystemExit(f"#{episode} が index.json に見つかりません")


@dataclass
class Span:
    start: float
    end: float
    text: str
    speaker: str | None

    def overlaps(self, start: float, end: float) -> bool:
        return self.start < end and self.end > start


def load(data: dict) -> list[Span]:
    return [
        Span(
            start=float(s["start"]),
            end=float(s["end"]),
            text=s.get("text", ""),
            speaker=s.get("speaker") or None,
        )
        for s in data.get("segments", [])
    ]


def at(spans: list[Span], time: float) -> str | None:
    """その時刻に喋っている人。重なっていれば先に始まったほう。"""
    for span in spans:
        if span.start <= time < span.end:
            return span.speaker
    return None


def same(a: str | None, b: str | None) -> bool:
    """同時発話は集合で比べる。「あずま・鉄塔」と「鉄塔・あずま」は同じ。"""
    if a == b:
        return True
    if not a or not b:
        return False
    return set(a.split("・")) == set(b.split("・"))


@dataclass
class Result:
    """採点の結果。混ぜると何を直せばいいか分からなくなるので分けて出す。"""

    #: 両方に発言がある時間のうち、話者が合っている割合
    accuracy: float
    #: 正解に発言があるのに、こちらが何も出していない時間（秒）
    missed: float
    #: こちらが発言を出しているのに、正解には何も無い時間（秒）
    extra: float
    #: 正解に発言がある時間（秒）
    speech: float
    misses: Counter


def score_speakers(truth: list[Span], ours: list[Span], ranges: list[dict]) -> Result:
    """秒単位で数える。

    発言の数ではなく時間で数える。1 文字の断片と 30 秒の発言を同じ 1 件として
    扱うと、実際の読みやすさと合わない。

    **話者の取り違えと、発言の取りこぼしを分ける。** 混ぜると「無し」が上位に
    並び、話者判定の問題に見えてしまう。実際には別の原因（落とされた発話）で、
    直す場所が違う。
    """
    hit = both = 0
    missed = extra = speech = 0
    run = 0
    misses: Counter = Counter()

    def flush() -> int:
        """続けて空いていた分を数える。短ければ境界の差として捨てる。"""
        nonlocal run
        length = run
        run = 0
        return length if length * FRAME_SEC >= MIN_MISS_SEC else 0

    for span in ranges:
        time = span["start"]
        while time < span["end"]:
            want = at(truth, time)
            got = at(ours, time)

            if want is not None:
                speech += 1

            if want is not None and got is None:
                run += 1
            else:
                missed += flush()

                if want is None and got is not None:
                    extra += 1
                elif want is not None and got is not None:
                    both += 1
                    if same(want, got):
                        hit += 1
                    else:
                        misses[f"{want} → {got}"] += 1

            time += FRAME_SEC

        missed += flush()

    return Result(
        accuracy=hit / both if both else 0.0,
        missed=missed * FRAME_SEC,
        extra=extra * FRAME_SEC,
        speech=speech * FRAME_SEC,
        misses=misses,
    )


def score_boundaries(
    truth: list[Span], ours: list[Span], ranges: list[dict]
) -> tuple[float, list[float]]:
    """正解の切れ目のうち、こちらにも切れ目がある割合。"""
    ours_edges = sorted({s.start for s in ours} | {s.end for s in ours})
    found = 0
    gaps: list[float] = []
    wanted = 0

    for span in ranges:
        edges = sorted(
            {s.start for s in truth if span["start"] <= s.start <= span["end"]}
            | {s.end for s in truth if span["start"] <= s.end <= span["end"]}
        )

        for edge in edges:
            wanted += 1
            nearest = min((abs(edge - e) for e in ours_edges), default=99.0)
            gaps.append(nearest)
            if nearest <= BOUNDARY_TOLERANCE_SEC:
                found += 1

    return (found / wanted if wanted else 0.0), gaps


def describe_misses(
    truth: list[Span], ours: list[Span], ranges: list[dict]
) -> list[str]:
    """正解の発言ごとに、こちらが何と言っているかを並べる。"""
    lines = []

    for want in truth:
        if not any(want.overlaps(r["start"], r["end"]) for r in ranges):
            continue

        overlapping = [s for s in ours if s.overlaps(want.start, want.end)]
        got = {s.speaker for s in overlapping}

        if len(got) == 1 and same(want.speaker, next(iter(got))):
            continue

        lines.append(
            f"  {want.start:7.2f}-{want.end:7.2f} 正解 {want.speaker or '無し':16} "
            f"{want.text[:34]!r}"
        )
        for s in overlapping:
            mark = " " if same(s.speaker, want.speaker) else "×"
            lines.append(
                f"    {mark} {s.start:7.2f}-{s.end:7.2f} {s.speaker or '無し':16} "
                f"{s.text[:34]!r}"
            )

    return lines


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("truth_file")
    parser.add_argument("ours_file")
    parser.add_argument("--detail", action="store_true")
    args = parser.parse_args()

    truth_data = json.load(open(args.truth_file))
    ranges = truth_data.get("ranges") or []
    name = args.ours_file
    ours = load(json.load(open(args.ours_file)))
    truth = load(truth_data)
    args.episode = "local"

    covered = sum(r["end"] - r["start"] for r in ranges)
    print(f"#{args.episode}  {name} と突き合わせ")
    print(f"確かめた範囲: {covered:.0f} 秒 / {len(ranges)} 区間")
    print()

    result = score_speakers(truth, ours, ranges)
    boundary, gaps = score_boundaries(truth, ours, ranges)
    median = sorted(gaps)[len(gaps) // 2] if gaps else 0.0

    print(f"話者の一致（両方に発言がある時間） {result.accuracy:6.1%}")
    print(f"切れ目の一致（±0.3秒）           {boundary:6.1%}  ずれの中央値 {median:.2f} 秒")
    print(f"取りこぼし（正解にあって無い）     {result.missed:5.1f} 秒"
          f" / 発言 {result.speech:.0f} 秒 = {result.missed / result.speech:.1%}")
    print(f"余分（正解に無いのに出している）   {result.extra:5.1f} 秒")
    print()

    if result.misses:
        print("話者の取り違え（多い順・秒数）")
        for label, count in result.misses.most_common(8):
            print(f"  {count * FRAME_SEC:6.1f} 秒  {label}")

    if args.detail:
        print("\n食い違っている箇所")
        for line in describe_misses(truth, ours, ranges):
            print(line)

    return 0


if __name__ == "__main__":
    sys.exit(main())
