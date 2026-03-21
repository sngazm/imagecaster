---
title: エピソード API
description: エピソードの作成・取得・更新・削除
sidebar:
  order: 1
---

import { Badge } from '@astrojs/starlight/components';

すべてのエンドポイントは Cloudflare Access による JWT 認証が必要です。

## エンドポイント一覧

| メソッド | パス | 説明 |
|--------|------|------|
| `GET` | `/api/episodes` | エピソード一覧取得 |
| `GET` | `/api/episodes/:id` | エピソード詳細取得 |
| `POST` | `/api/episodes` | エピソード新規作成 |
| `PUT` | `/api/episodes/:id` | エピソード更新 |
| `DELETE` | `/api/episodes/:id` | エピソード削除 |

---

## GET /api/episodes

エピソード一覧を取得します。すべての `publishStatus` のエピソードを返します。

### レスポンス

```json
{
  "episodes": [
    {
      "id": "ep_abc123",
      "title": "第1回 はじめに",
      "publishStatus": "published",
      "transcribeStatus": "completed",
      "publishAt": "2024-01-01T09:00:00.000Z",
      "publishedAt": "2024-01-01T09:00:00.000Z",
      "createdAt": "2023-12-28T10:00:00.000Z"
    }
  ]
}
```

---

## GET /api/episodes/:id

エピソードの全メタデータを取得します。

### パラメーター

| 名前 | 場所 | 説明 |
|------|------|------|
| `id` | パス | エピソード ID |

### レスポンス

`EpisodeMeta` オブジェクト全体を返します。詳細は [ストレージ](../architecture/storage/) を参照。

---

## POST /api/episodes

エピソードを新規作成します。

### リクエストボディ

```typescript
interface CreateEpisodeRequest {
  title: string;                      // 必須
  slug?: string;                      // 省略時は title から自動生成
  description?: string;               // HTML 形式
  publishAt?: string | null;          // ISO 8601、null でドラフト
  skipTranscription?: boolean;        // デフォルト: false
  blueskyPostText?: string | null;
  blueskyPostEnabled?: boolean;
  referenceLinks?: ReferenceLink[];
}
```

### レスポンス

```json
{
  "id": "ep_abc123",
  "slug": "first-episode",
  "publishStatus": "new",
  "transcribeStatus": "none"
}
```

---

## PUT /api/episodes/:id

エピソードのメタデータを更新します。

### リクエストボディ

```typescript
interface UpdateEpisodeRequest {
  title?: string;
  slug?: string;
  description?: string;
  publishAt?: string | null;          // null でドラフトに戻す
  skipTranscription?: boolean;
  hideTranscription?: boolean;
  blueskyPostText?: string | null;
  blueskyPostEnabled?: boolean;
  referenceLinks?: ReferenceLink[];
  applePodcastsUrl?: string | null;
  applePodcastsFetchedAt?: string | null;
  spotifyUrl?: string | null;
  transcribeStatus?: TranscribeStatus; // 失敗からのリトライ用
}
```

`publishAt` に将来の日時を設定すると `publishStatus` が `scheduled` になります。

### 自動リビルドのトリガー

以下の条件で公開サイトのリビルドがトリガーされます。

- `published` のエピソードの `title` または `description` が変更された場合

---

## DELETE /api/episodes/:id

エピソードを削除します。

### 削除されるもの

- `episodes/{storageKey}/meta.json`
- `episodes/{storageKey}/audio.mp3`（存在する場合）
- `episodes/{storageKey}/transcript.vtt`（存在する場合）
- `episodes/{storageKey}/artwork.jpg`（存在する場合）
- `index.json` からの削除
- `feed.xml` の再生成

`published` だったエピソードを削除した場合、公開サイトのリビルドがトリガーされます。

---

## 型定義

```typescript
interface ReferenceLink {
  url: string;
  title: string;
}

type PublishStatus = "new" | "uploading" | "draft" | "scheduled" | "published";

type TranscribeStatus =
  | "none" | "pending" | "transcribing"
  | "completed" | "failed" | "skipped";
```
