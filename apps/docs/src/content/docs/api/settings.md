---
title: 設定 API
description: Podcast の設定管理
sidebar:
  order: 3
---

## エンドポイント一覧

| メソッド | パス | 説明 |
|--------|------|------|
| `GET` | `/api/settings` | 設定取得 |
| `PUT` | `/api/settings` | 設定更新 |
| `POST` | `/api/settings/artwork/upload-url` | カバーアート Presigned URL 発行 |
| `POST` | `/api/settings/artwork/upload-complete` | カバーアート完了通知 |

---

## GET /api/settings

Podcast の設定を取得します。`index.json` の `podcast` フィールドを返します。

### レスポンス

```json
{
  "title": "My Podcast",
  "description": "番組の説明",
  "author": "配信者名",
  "email": "contact@example.com",
  "language": "ja",
  "category": "Technology",
  "artworkUrl": "https://pub-xxx.r2.dev/assets/artwork.jpg",
  "websiteUrl": "https://your-podcast.example.com",
  "explicit": false,
  "applePodcastsId": "123456789",
  "applePodcastsAutoFetch": true,
  "spotifyShowId": "abc123",
  "spotifyAutoFetch": true,
  "applePodcastsUrl": "https://podcasts.apple.com/...",
  "spotifyUrl": "https://open.spotify.com/show/..."
}
```

---

## PUT /api/settings

Podcast の設定を更新します。指定したフィールドのみ上書きされます。

### リクエストボディ

```typescript
interface UpdatePodcastSettingsRequest {
  title?: string;
  description?: string;
  author?: string;
  email?: string;
  language?: string;
  category?: string;
  websiteUrl?: string;
  explicit?: boolean;
  applePodcastsId?: string | null;
  applePodcastsAutoFetch?: boolean;
  spotifyShowId?: string | null;
  spotifyAutoFetch?: boolean;
  applePodcastsUrl?: string;
  spotifyUrl?: string;
}
```

設定を変更しても公開サイトのリビルドは自動トリガーされません。必要に応じて手動でリビルドしてください。

---

## POST /api/settings/artwork/upload-url

Podcast カバーアート用 Presigned URL を発行します。

### リクエストボディ

```typescript
{
  contentType: string;   // 例: "image/jpeg"
  fileSize: number;
}
```

アップロード先は `assets/artwork.jpg` です。

---

## POST /api/settings/artwork/upload-complete

カバーアートのアップロード完了を通知します。`index.json` の `podcast.artworkUrl` が更新されます。
