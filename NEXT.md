# 次にやること

読んだら消してよい。

## 手を動かす必要があるもの

### メール通知の設定（未完了）

WSL の `~/dev/imagecaster-transcriber/config.yaml` に追記する。

```yaml
notification:
  enabled: true
  smtp_host: "smtp.gmail.com"
  smtp_port: 587
  username: "自分のアドレス@gmail.com"
  password: "アプリパスワード"
  to_address: "shirahadori@gmail.com"
  episode_url_template: "https://cast.image.club/episodes/{id}/"
```

アプリパスワードは https://myaccount.google.com/apppasswords で発行する。
通常のログインパスワードでは送れない。設定したらワーカーを再起動する。

**Cloudflare Email を使わなかった理由**: `image.club` のメールは Xserver 運用で、
Cloudflare Email Sending を有効にすると MX を書き換えることになる。既存のメールに
影響するため DNS は触らなかった。

### 辞書を見て、要らない規則を消す

校正が自動で足した規則が **設定 → 文字起こし** に並んでいる。安全側に倒す検査は
入れてあるが、番組の中身を知らないと判断できないものは残る。目を通してほしい。

### 公開済み全266本への一括再適用

**設定 → 文字起こしの「公開済みエピソードに再適用」** は実行していない。
辞書を確認してから判断してほしい。Cron が少しずつ処理する。

## API キーは要らなくなった

校正も感想も、文字起こしを回すマシンの `claude` コマンドを呼んでいる。
`ANTHROPIC_API_KEY` は不要。

## 話者を出すには

音量の比較には音声そのものが要るので、判定は文字起こしと同時にしかできない。

1. エピソード編集画面で話者トラックの zip をアップロード
   （zip を選ぶと中身を読んでトラックが自動で並ぶ。BGM のトラックは名前を空にする）
2. 「音声から文字起こしをやり直す」を実行

番組全体の既定は 設定 → 文字起こし で設定済み（track1=あずま / track2=鉄塔 / track3=BGM）。

zip は軽くしてよい。判定に使うのは音量だけなので、16kHz モノラルの flac に落とせば
0285 は 363MB → 67MB になる。

```bash
for i in 1 2 3; do
  ffmpeg -i "cast_0285 — Track $i.wav" -ar 16000 -ac 1 -c:a flac "Track $i.flac"
done
zip -j tracks.zip *.flac
```

Nextcloud を見た範囲では、全編のトラックが揃っているのは 0285 だけだった。

## 変更したら、公開サイトを読み返す

```bash
node scripts/audit-site.mjs
```

これが 0 件を返したときに終わりとする。テストが通ってデータが正しく保存されていても、
公開されたページが読み物として壊れていることがある。実際に2回やった
（「ヤンヤン」883件の残存、`メール → mail` の自動登録）。

## WSL のコードを更新したら

`scripts/run-worker.sh` に git pull は入っていない。手で pull して再起動する。

```bash
ssh wsl
cd ~/dev/imagecaster-transcriber
git pull --ff-only
pkill -f "imagecaster-transcriber worker"
rm -f .worker.lock
setsid nohup ./scripts/run-worker.sh > /tmp/worker.log 2>&1 < /dev/null &
```

## 仕組みの説明

https://claude.ai/code/artifact/8c98074c-9cf3-43cb-a8dd-2d4f9659cc98

## 手を付けていないこと

- #276〜#279 は `skipTranscription: true`。音声はあるので、やるなら編集画面で外す
