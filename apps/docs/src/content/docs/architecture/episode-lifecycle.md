---
title: エピソードのライフサイクル
description: エピソードが作成されてから公開されるまでのステータス遷移
sidebar:
  order: 4
---

## ステータス遷移図

### 文字起こしあり（skipTranscription: false）

```
new → uploading → draft → scheduled → published
                    ↑
                transcribing
                (draft に戻る)
```

より詳しく:

```
new
  │ POST /api/episodes/:id/upload-url
  ↓
uploading
  │ POST /api/episodes/:id/upload-complete
  ↓
draft ←────────────────────────────────────┐
  │ PUT /api/episodes/:id (publishAt 設定)  │
  ↓                                         │
scheduled                                   │
  │ [Cron: 5分ごと / publishAt 経過]        │
  ↓                                         │
published                                   │
                                            │
  文字起こし完了通知で transcribeStatus: "completed" になった後、
  文字起こし失敗時 transcribeStatus: "failed" / リトライ可能
```

### 文字起こしスキップ（skipTranscription: true）

```
new → uploading → draft → scheduled → published
```

文字起こしキューへの追加をスキップし、`transcribeStatus` は `skipped` のままになります。

## 各ステータスの詳細

### `new`

エピソード作成直後の初期状態。音声ファイルはまだありません。

- API: `POST /api/episodes` で作成

### `uploading`

音声ファイルのアップロードまたはダウンロード中。

- API: `POST /api/episodes/:id/upload-url`（Presigned URL 発行）
- API: `POST /api/episodes/:id/upload-from-url`（URL からダウンロード）

### `draft`

音声ファイルのアップロードが完了した状態。公開予約なし。

- API: `POST /api/episodes/:id/upload-complete`（アップロード完了通知）
- `skipTranscription: false` の場合、`transcribeStatus` が `pending` になりキューに追加

### `scheduled`

公開日時（`publishAt`）が設定済み。

- API: `PUT /api/episodes/:id`（`publishAt` を設定）
- Worker の Cron が 5 分ごとにチェック

### `published`

公開済み。リスナーが閲覧可能。

- Cron が `publishAt` を過ぎたエピソードを自動公開
- `index.json` に追加され、RSS フィードに含まれる
- 公開サイトのリビルドがトリガーされる
- `blueskyPostEnabled: true` の場合、Bluesky に投稿

## 文字起こしステータス

文字起こし処理は `publishStatus` とは独立して管理されます。

| transcribeStatus | 説明 |
|-----------------|------|
| `none` | 未開始（`skipTranscription: true` の場合の初期値） |
| `pending` | キュー待ち（アップロード完了後に設定） |
| `transcribing` | 外部サービスが処理中（ソフトロック中） |
| `completed` | 完了（`transcript.vtt` が R2 に保存済み） |
| `failed` | 失敗（エラーメッセージあり、リトライ可能） |
| `skipped` | スキップ（`skipTranscription: true` のエピソード） |

### ソフトロック

文字起こしサービスが同じエピソードを二重処理しないように、`transcriptionLockedAt` で処理中を示します。ロックは 1 時間で自動解除されます。

外部サービスは `GET /api/transcription/queue` でキューを取得し、処理完了後に `POST /api/episodes/:id/transcription-complete` で通知します。

詳細は [文字起こし](../../features/transcription/) を参照してください。
