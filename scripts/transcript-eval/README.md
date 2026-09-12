# 文字起こしの採点道具（2026-09-05 の #281 調査で作ったもの）

正解データ `transcript.truth.json`（管理画面の正解エディタで作る）と突き合わせて測る。
入力は R2 の公開 URL から落とした JSON をそのまま渡す。

| 道具 | 用途 |
|---|---|
| `cer.py truth.json ours.json [--strip-fillers] [--detail]` | 本文の文字誤り率。確かめた範囲だけを、単語の時刻で切って比べる。`--strip-fillers` で Worker と同じフィラー一覧を両側から落とす |
| `score_local.py truth.json ours.json [--detail]` | 話者の一致（transcriber の scripts/score.py をローカルファイル対応にしたもの） |
| `score_any.py truth.json ours1.json ours2.json …` | 話者の一致を、厳密（先に始まった人）と重なり許容（その時刻に喋っている誰かと一致）の両方で並べる |
| `pp_runner.ts raw.json index.json meta.json out.json [global\|full]` | Worker の後処理をローカルで同じ引数で呼ぶ。公開データと一致することを確認済み。esbuild で bundle して node で実行 |
| `pp_stages.ts raw.json index.json meta.json prefix` | 後処理を 1 段ずつ書き出す。`SKIP_REPAIR=1` で repairSpeakerBoundaries を飛ばす |
| `fetch.sh storageKey out_dir` | 公開データ一式（meta / raw / json / truth / levels / index）を R2 から取る |
| `punct_check.py transcript.json …` | 5 分ごとの句読点の割合と、文として閉じていない行の数 |
| `punct_diff.py truth.json ours.json [--detail]` | 正解の区切り（。／…／、／行末）ごとに、こちらが何を打っているかを数える。「余分な読点」「句点が読点に」「言いさしが句点に」が見える |
| `cuts_check.py raw.json …` | 話者交代のうち文の途中で切れているものの数と例 |
| `names_holes.py raw.json …` | 固有名詞の出現数と、3 秒以上の穴 |
| `compare.py truth.json a.json b.json … [--all]` | 正解の行ごとに、各候補が何と言っているか（主な話者と本文）を並べる。数字の上下の中身を見るのに使う。単語の中点で切るので、単語の無い Worker の出力には向かない |

実行例:

```bash
B=https://cast-bucket.image.club/episodes/281-2gvci51k
for f in meta.json transcript.raw.json transcript.json transcript.truth.json levels.json; do curl -sO $B/$f; done
curl -sO https://cast-bucket.image.club/index.json
python3 cer.py transcript.truth.json transcript.raw.json --strip-fillers --detail
apps/worker/node_modules/.bin/esbuild pp_runner.ts --bundle --platform=node --format=esm --outfile=pp_runner.mjs
node pp_runner.mjs transcript.raw.json index.json meta.json out.json global
```

注意: 正解データは 171 秒（3 区間・906 文字）しかなく、1 文字 = 0.11%。また正解自体に
「MageCast!」（正しくは Image Cast）、「イメージクラブ」、2 人の区間が重なって
記録されている箇所があり、それらは採点上こちらの誤りに数えられる。
