---
title: アップロード API
description: 音声ファイルとアートワークのアップロード処理
sidebar:
  order: 2
---

音声ファイルは Worker を経由せず、**Presigned URL** を使ってブラウザから R2 に直接アップロードします。

## エンドポイント一覧

| メソッド | パス | 説明 |
|--------|------|------|
| `POST` | `/api/episodes/:id/upload-url` | Presigned URL 発行（音声） |
| `POST` | `/api/episodes/:id/upload-complete` | アップロード完了通知 |
| `POST` | `/api/episodes/:id/upload-from-url` | URL からダウンロード |
| `POST` | `/api/episodes/:id/transcription-complete` | 文字起こし完了通知 |
| `POST` | `/api/episodes/:id/artwork/upload-url` | Presigned URL 発行（アートワーク） |
| `POST` | `/api/episodes/:id/artwork/upload-complete` | アートワーク完了通知 |

---

## 音声アップロードの流れ

```
管理画面                    Worker                      R2
   │                          │                          │
   ├─ POST /upload-url ──────►│                          │
   │                          ├─ Presigned URL 生成 ────►│
   │◄──── { uploadUrl } ──────┤                          │
   │                          │                          │
   ├─ PUT {uploadUrl} ────────┼─────────────────────────►│
   │    (音声ファイル直接)      │                          │
   │                          │                          │
   ├─ POST /upload-complete ─►│                          │
   │                          ├─ meta.json 更新          │
   │                          ├─ index.json 更新         │
   │                          └─ feed.xml 再生成         │
```

---

## POST /api/episodes/:id/upload-url

Presigned URL を発行します。

### リクエストボディ

```typescript
interface UploadUrlRequest {
  contentType: string;   // 例: "audio/mpeg"
  fileSize: number;      // バイト単位
}
```

### レスポンス

```json
{
  "uploadUrl": "https://...r2.cloudflarestorage.com/...?X-Amz-Signature=...",
  "expiresIn": 3600
}
```

取得した `uploadUrl` に対して `PUT` リクエストで音声ファイルをアップロードしてください。

---

## POST /api/episodes/:id/upload-complete

音声アップロード完了を通知します。`publishStatus` が `uploading` → `draft` に変わります。

`skipTranscription: false` の場合、`transcribeStatus` が `pending` になり文字起こしキューに追加されます。

### リクエストボディ

```typescript
interface UploadCompleteRequest {
  duration: number;     // 音声の長さ（秒）
  fileSize?: number;    // バイト単位（開発環境用、R2 Binding が使えない場合）
}
```

---

## POST /api/episodes/:id/upload-from-url

指定した URL から音声ファイルを Worker がダウンロードして R2 に保存します。RSS インポート時に使用します。

### リクエストボディ

```typescript
interface UploadFromUrlRequest {
  sourceUrl: string;    // ダウンロード元 URL
}
```

---

## POST /api/episodes/:id/transcription-complete

外部の文字起こしサービスから処理完了を通知します。

### リクエストボディ

```typescript
interface TranscriptionCompleteRequest {
  transcribeStatus: "completed" | "failed";
  duration?: number;          // 音声長さの更新（秒）
  errorMessage?: string;      // 失敗時のエラーメッセージ
}
```

`completed` の場合、文字起こしサービスは事前に `transcript.vtt` を R2 にアップロードしておく必要があります。

パス: `episodes/{storageKey}/transcript.vtt`

---

## POST /api/episodes/:id/artwork/upload-url

エピソード固有のアートワーク用 Presigned URL を発行します。

### リクエストボディ

```typescript
{
  contentType: string;   // 例: "image/jpeg"
  fileSize: number;
}
```

---

## POST /api/episodes/:id/artwork/upload-complete

アートワークのアップロード完了を通知します。`meta.json` の `artworkUrl` が更新されます。
