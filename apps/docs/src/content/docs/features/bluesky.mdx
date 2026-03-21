---
title: Bluesky 連携
description: エピソード公開時の Bluesky 自動投稿
sidebar:
  order: 2
---

import { Aside } from '@astrojs/starlight/components';

エピソードが公開されたとき、Bluesky に自動投稿できます。

## 設定

### シークレットの設定

```bash
cd apps/worker
npx wrangler secret put BLUESKY_IDENTIFIER   # ハンドル (例: user.bsky.social)
npx wrangler secret put BLUESKY_PASSWORD     # アプリパスワード
```

<Aside type="tip">
通常のパスワードではなく、Bluesky の**アプリパスワード**を使用してください。
Settings → Privacy and Security → App Passwords で作成できます。
</Aside>

## エピソードごとの設定

管理画面でエピソードごとに投稿の設定ができます。

| フィールド | 説明 |
|-----------|------|
| `blueskyPostEnabled` | `true` の場合、公開時に Bluesky へ投稿 |
| `blueskyPostText` | 投稿テキスト（省略時はデフォルトのテキストを使用） |

API 経由での設定:

```json
PUT /api/episodes/:id
{
  "blueskyPostEnabled": true,
  "blueskyPostText": "新しいエピソードを公開しました！\n\nエピソードはこちら: {url}"
}
```

## 投稿のタイミング

以下のタイミングで Bluesky への投稿が実行されます。

1. **即時公開**: `PUT /api/episodes/:id` で `publishAt` を過去の日時にした場合
2. **スケジュール公開**: Worker の Cron（5分ごと）が `publishAt` 経過を検知した場合

`blueskyPostedAt` に投稿済みの日時が記録されます。一度投稿したエピソードは再投稿されません。

## 投稿内容

投稿テキストに以下のプレースホルダーを使用できます（実装依存）。

カスタムテキストを設定しない場合、`{エピソードタイトル} - {サイトURL}` のような形式で投稿されます。

## 投稿確認

`meta.json` の `blueskyPostedAt` フィールドで投稿済みかどうかを確認できます。
