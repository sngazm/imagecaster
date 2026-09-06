#!/bin/bash
# エピソードの公開データ一式を R2 から取る（キャッシュを避けるため ?v= を付ける）
#   scripts/transcript-eval/fetch.sh 281-2gvci51k out_dir
set -e
KEY=${1:?storageKey (例 281-2gvci51k)}; OUT=${2:-.}
mkdir -p "$OUT"
B=https://cast-bucket.image.club/episodes/$KEY
for f in meta.json transcript.raw.json transcript.json transcript.truth.json levels.json; do
  curl -s -o "$OUT/$f" "$B/$f?v=$(date +%s)"
done
curl -s -o "$OUT/index.json" "https://cast-bucket.image.club/index.json?v=$(date +%s)"
ls -la "$OUT"
