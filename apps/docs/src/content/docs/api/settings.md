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

---

## 文字起こしの後処理設定

`GET /api/settings` のレスポンスと `PUT /api/settings` のリクエストには、
文字起こしの後処理設定が含まれます。未設定の場合は既定値が返ります。

```typescript
{
  transcriptPostProcess: {
    // トラック番号への話者名の既定割り当て
    // label が null のトラックは BGM 等の非発話として話者判定から除外される
    speakerDefaults: Array<{ track: number; label: string | null }>;

    // 同じ話者の連続したセグメントをまとめる条件
    merge: {
      enabled: boolean;
      maxGapSec: number | null;  // null なら発話の間の長さを条件にしない
      maxDurationSec: number;    // まとめた結果がこれを超えないようにする
      maxChars: number;
    };

    // 誤字の置き換え。上から順に適用される
    corrections: Array<{
      from: string;
      to: string;
      enabled: boolean;
      note?: string;   // なぜこのルールを入れたか
    }>;
  };
}
```

不正な値（トラック番号が 0 以下、`from` が空のルールなど）は保存時に取り除かれます。
話者名に空文字を渡した場合は `null`（非発話トラック）として保存されます。

設定を変えただけでは既存のエピソードは変わりません。過去の分に反映するには
`POST /api/transcription/reprocess-all` を使います。
