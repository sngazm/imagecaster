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

アップロードが途中で失敗すると `uploading` のまま残ることがあります。この状態でも上記 2 つの API は再実行（リトライ）を許可しているため、管理画面から再度アップロードすれば復帰できます。なお `upload-from-url` はダウンロード失敗時に `new` へ自動で戻します。

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

### フィード再生成のタイミング

`feed.xml` の再生成は published エピソード全件の `meta.json` を読み込むため CPU を大量に消費します。リクエスト処理の中で実行すると、エピソード数が増えるにつれて Worker のリソース制限（Cloudflare の Error 1102）に達し、**処理が途中で打ち切られます**。1102 は実行そのものが停止するため `try/catch` では捕捉できません。

そのため文字起こし完了通知では、`index.json` の `feedDirty` フラグを立てるだけにして、実際の再生成は Cron（5分間隔）に委ねています。

```
完了通知 ─► meta.json 更新 ─► feedDirty: true を立てて即座に応答
                                      │
Cron (5分ごと) ─────────────────────► feed.xml 再生成 ─► feedDirty: false
```

### 文字起こし待ちインデックス

`GET /api/transcription/queue` も以前は全エピソードを走査しており、同じく 1102 の原因になっていました。現在は `index.json` の `transcriptionQueueIds` に文字起こし待ち（`pending` / `transcribing`）のエピソードIDを保持し、**そこに載っているものだけ**を読みます。

インデックスの更新は `saveEpisodeMeta()` に組み込まれています。`transcribeStatus` が変わる経路はロック取得・完了通知・リトライ・アップロード完了など多岐にわたるため、取りこぼしを防ぐ目的でメタデータ保存の共通処理として実行します。エピソード削除時のみ `meta.json` が消えて追随できないため、削除処理側で明示的に除去します。

`transcriptionQueueIds` が未定義（未構築）の場合は、次回のキュー取得時に一度だけ全件走査して初期化します。既存環境からの移行はこれで自動的に行われます。

外部サービス側のポーリング間隔は 300 秒程度を推奨します。
