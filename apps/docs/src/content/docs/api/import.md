---
title: インポート API
description: RSS フィードからのエピソードインポート
sidebar:
  order: 5
---

## エンドポイント一覧

| メソッド | パス | 説明 |
|--------|------|------|
| `POST` | `/api/import/rss` | RSS からエピソードをインポート |
| `POST` | `/api/import/rss/preview` | インポートのプレビュー（実行なし） |
| `GET` | `/api/deployments` | デプロイ状況取得 |
| `GET` | `/api/health` | ヘルスチェック（認証不要） |

---

## POST /api/import/rss

RSS フィードからエピソードをインポートします。すでにインポート済みの GUID はスキップされます。

### リクエストボディ

```typescript
interface ImportRssRequest {
  rssUrl: string;
  importAudio?: boolean;           // 音声ファイルをダウンロードするか（デフォルト: false）
  importArtwork?: boolean;         // エピソードアートワークをダウンロードするか
  importPodcastSettings?: boolean; // Podcast 設定も上書きするか
  customSlugs?: Record<string, string>; // インデックス(0始まり) → slug のマッピング
  skipTranscription?: boolean;     // 文字起こしをスキップするか（デフォルト: true）
}
```

### レスポンス

```json
{
  "imported": 5,
  "skipped": 2,
  "episodes": [
    {
      "title": "第1回",
      "slug": "episode-1",
      "status": "imported"
    },
    {
      "title": "第2回",
      "slug": "episode-2",
      "status": "skipped",
      "reason": "Already imported (GUID match)"
    }
  ]
}
```

### importAudio について

`importAudio: true` の場合、Worker が音声 URL からファイルをダウンロードして R2 に保存します。大容量ファイルや多数のエピソードがある場合は Worker のタイムアウト（30秒）に注意してください。

`importAudio: false`（デフォルト）の場合、音声は外部 URL を `sourceAudioUrl` として参照するだけで、ダウンロードしません。

---

## POST /api/import/rss/preview

インポートをシミュレートして結果をプレビューします。実際のデータ変更は行いません。

### リクエストボディ

`POST /api/import/rss` と同じ形式。

### レスポンス

インポートした場合の結果を返します（実際には何も変更されません）。

---

## GET /api/deployments

Cloudflare Pages のデプロイ状況を取得します。

`CLOUDFLARE_API_TOKEN` と `PAGES_PROJECT_NAME` が設定されている場合のみ有効です。

### レスポンス

```json
{
  "deployments": [
    {
      "id": "deploy_abc123",
      "shortId": "abc123",
      "url": "https://abc123.podcast-web.pages.dev",
      "createdOn": "2024-01-01T09:00:00.000Z",
      "modifiedOn": "2024-01-01T09:05:00.000Z",
      "latestStage": {
        "name": "success",
        "status": "success",
        "startedOn": "2024-01-01T09:00:00.000Z",
        "endedOn": "2024-01-01T09:05:00.000Z"
      },
      "deploymentTrigger": {
        "type": "ad_hoc",
        "metadata": {
          "branch": "main",
          "commitHash": "abc123",
          "commitMessage": "Update episode"
        }
      }
    }
  ],
  "configured": true,
  "websiteUrl": "https://your-podcast.example.com",
  "accountId": "xxx",
  "projectName": "podcast-web"
}
```

`configured: false` の場合、`deployments` は空配列になります。

---

## GET /api/health

ヘルスチェック用エンドポイント。認証不要でアクセスできます。

### レスポンス

```json
{
  "status": "ok"
}
```
