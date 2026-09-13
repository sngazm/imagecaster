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

## 文字起こしの整形設定

`GET /api/settings` のレスポンスと `PUT /api/settings` のリクエストには、
文字起こしの整形設定が含まれます。未設定の場合は既定値が返ります。

:::note[旧キーについて]
このキーは以前 `transcriptPostProcess` という名前でした（「後処理」を「整形」に
改めたときに変えています）。R2 の `index.json` に旧キーで入っているデータは、
読み込み時に `transcriptRefine` へ移し替えられ、次の保存で書き戻ります。

Worker と管理画面は別々にデプロイされるので、移行期間は `GET` が**両方の名前で
同じ値を返し**、`PUT` は**どちらの名前でも受け取り**ます。管理画面が新しくなったら、
旧名の口は閉じてかまいません。
:::

```typescript
{
  transcriptRefine: {
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

    // 同時発話を検出する範囲（冒頭からの秒数）。null なら検出しない
    simultaneousUntilSec: number | null;

    // Whisper のハルシネーションの除去
    hallucination?: {
      phrases: string[];        // セグメント全体がこの語と一致したら削除する
      leadingLabels: string[];  // 行頭の架空の話者ラベル（「深井」「ヤンヤン」）。文字起こし側が学習して足す
      maxRepeat: number;        // 同じ単位の繰り返しをこの回数で切り詰める
      maxConsecutive: number;   // 同じ文のセグメントがこの回数を超えて続いたら畳む
    };
  };
}
```

不正な値（トラック番号が 0 以下、`from` が空のルールなど）は保存時に取り除かれます。
話者名に空文字を渡した場合は `null`（非発話トラック）として保存されます。
`simultaneousUntilSec` に 0 以下を渡した場合は `null`（検出しない）になります。

設定を変えただけでは既存のエピソードは変わりません。過去の分に反映するには
`POST /api/transcription/reprocess-all` を使います。
