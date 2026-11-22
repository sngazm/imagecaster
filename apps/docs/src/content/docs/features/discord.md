---
title: Discord への告知
description: 新しいエピソードと Patreon の投稿を Discord に知らせる
sidebar:
  order: 3
---

新しいエピソードが公開サイトに出たとき、Discord のチャンネルに知らせます。Patreon の新しい
投稿（アフタートーク）も同じチャンネルに出せます。RSS を読む外部の bot は要りません。

## エピソードの告知

### 設定

Discord のチャンネルの設定（連携サービス → ウェブフック）で Webhook を作り、その URL を置きます。

```bash
npx wrangler secret put DISCORD_WEBHOOK_URL
```

URL はそれ自体が鍵です。知っていれば誰でもそのチャンネルに書き込めます。

設定していなければ、何も起きません。

### 出るタイミング

**公開した瞬間ではなく、公開サイトにページが出てから**です。

公開サイトは静的ビルドなので、公開から数分はエピソードのページがまだありません。その間に
URL を貼ると、押した人には何も出ず、Discord が作るリンクのカードも空のまま固まります。

1. エピソードが初めて公開されたとき、`index.json` の `discordAnnounceIds` に入る
2. Cron（5 分ごと）がそのエピソードのページを取りに行く
3. ページが出ていれば Webhook に投稿し、`meta.json` の `discordPostedAt` に日時を残す
4. まだなら次の回に持ち越す。投稿に失敗したときも同じ

公開サイトは存在しないパスにもトップページを 200 で返します。そのためステータスではなく、
返ってきた本文にそのエピソード自身の URL（`og:url`）が入っているかで「出た」を見分けます。

公開から 24 時間たっても出せなければ諦めます（ログに残ります）。

### 告知されるもの・されないもの

- 告知されるのは、**初めて公開された**エピソードだけ（`publishedAt` が初めて入ったとき）
- 一度下書きに戻して出し直しても、もう一度は出ない
- RSS から取り込んだ過去の回は出ない
- 投稿はタイトルと URL。カードは Discord が公開サイトの OGP から作る

## Patreon の投稿の告知

Patreon の Webhook（`posts:publish`）を Worker が受けて、同じ Discord の Webhook に出します。
Patreon には公開の RSS が無く、API を見回る方式はトークンの更新が要るので、向こうから
知らせてもらう形にしています。

### 設定

1. Worker の workers.dev の URL を確かめる（`wrangler deploy` の出力に出る）。
   `caster.image.club` は丸ごと Cloudflare Access の内側にあり、Patreon からは届きません
2. [Patreon の Webhook の登録ページ](https://www.patreon.com/portal/registration/register-webhooks)で、
   `https://<workers.dev の URL>/api/webhooks/patreon` を登録し、トリガーに `posts:publish` を選ぶ
3. 表示された secret を置く

```bash
npx wrangler secret put PATREON_WEBHOOK_SECRET
```

`DISCORD_WEBHOOK_URL` も要ります。どちらかが無ければ 503 を返します。

### 動き

- `X-Patreon-Signature`（本文を secret で HMAC-MD5 にかけた 16 進）を確かめる。合わなければ 401
- `posts:publish` 以外（編集・削除）は何もしない
- Discord に出せなかったら 502 を返す。Patreon が間を置いて送り直してくる
- 告知した投稿の id を `index.json` の `patreonAnnouncedPostIds` に直近 50 件控え、二重に出さない
- 公開範囲では絞らない。Patreon で公開した投稿はすべて出る

投稿の中身の形は Patreon の文書に載っていません。当てにしているのは投稿の id だけで、題名と
URL は入っていれば使い、無ければ `https://www.patreon.com/posts/{id}` を出します。
