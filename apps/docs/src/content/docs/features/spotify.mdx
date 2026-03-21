---
title: Spotify 連携
description: Spotify エピソード URL の自動取得
sidebar:
  order: 5
---

import { Aside } from '@astrojs/starlight/components';

Spotify に登録した Podcast のエピソード URL を自動取得できます。

<Aside type="caution">
2026年1月現在、Spotify Developer の新規アプリ登録が一時停止されています。既存のアプリがある場合のみ設定可能です。
</Aside>

## 設定

### Spotify Developer アプリの作成

1. [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) にアクセス
2. **Create app** → アプリ名・説明・Redirect URI を入力
3. **Web API** にチェック → 作成
4. **Settings** から **Client ID** と **Client secret** をコピー

### シークレットの設定

```bash
cd apps/worker
npx wrangler secret put SPOTIFY_CLIENT_ID
npx wrangler secret put SPOTIFY_CLIENT_SECRET
```

### Show ID の設定

管理画面の **設定** → **Spotify 連携** で:

1. **Spotify Show ID** を入力（Spotify Podcast URL から取得）
2. **自動取得を有効化** をオン

## 自動取得の仕組み

管理画面起動時（`applePodcastsAutoFetch: true` の場合）に `GET /api/settings` が実行され、Spotify のエピソード一覧と照合して URL を取得します。

取得タイミング:
- 管理画面の起動時
- エピソードが公開されてから **1日以上** 経過した場合のみ取得を試みる

取得した URL は `meta.json` の `spotifyUrl` に保存されます。

## 手動設定

自動取得を使わずに手動で URL を設定することも可能です:

```json
PUT /api/episodes/:id
{
  "spotifyUrl": "https://open.spotify.com/episode/..."
}
```
