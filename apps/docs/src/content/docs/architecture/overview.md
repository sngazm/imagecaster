---
title: 全体構成
description: Imagecaster のアーキテクチャ詳細
sidebar:
  order: 1
---

## スタック

| レイヤー | 技術 |
|---------|------|
| パッケージ管理 | pnpm + Turborepo |
| API | Cloudflare Workers + Hono |
| 公開サイト | Astro (SSG) |
| 管理画面 | React + Vite + Tailwind CSS |
| ストレージ | Cloudflare R2 |
| 認証 | Cloudflare Access (JWT) |
| ホスティング | Cloudflare Pages |
| テスト | Vitest + @cloudflare/vitest-pool-workers |

## ディレクトリ構成

```
apps/
├── worker/
│   ├── src/
│   │   ├── index.ts          # Hono アプリのエントリーポイント
│   │   ├── types.ts          # 型定義
│   │   ├── routes/           # API ルートハンドラー（11ファイル）
│   │   └── services/         # ビジネスロジック（9ファイル）
│   └── wrangler.toml
├── web/
│   └── src/
│       ├── pages/            # Astro ページ
│       ├── components/       # UI コンポーネント
│       └── lib/              # API クライアント
├── admin/
│   └── src/
│       ├── pages/            # React Router ページ
│       ├── components/       # UI コンポーネント
│       └── lib/              # API クライアント
└── docs/
    └── src/content/docs/     # このドキュメント
```

## Worker の構成

### ルートハンドラー (`apps/worker/src/routes/`)

| ファイル | 担当 |
|---------|------|
| `episodes.ts` | エピソード CRUD |
| `upload.ts` | Presigned URL 発行、アップロード完了処理 |
| `settings.ts` | Podcast 設定管理 |
| `templates.ts` | 概要欄テンプレート CRUD |
| `import.ts` | RSS インポート |
| `transcription.ts` | 文字起こしキュー管理 |
| `deployments.ts` | Cloudflare Pages デプロイ状況確認 |
| `podcast.ts` | Podcast メタデータ管理 |
| `backup.ts` | バックアップ（エクスポート / インポート） |
| `spotify.ts` | Spotify 連携 |
| `debug.ts` | デバッグユーティリティ |

### サービス (`apps/worker/src/services/`)

| ファイル | 担当 |
|---------|------|
| `r2.ts` | R2 へのデータ読み書き（index.json、meta.json） |
| `feed.ts` | RSS フィード生成 |
| `bluesky.ts` | Bluesky への投稿 |
| `deploy.ts` | Web サイトのリビルドトリガー |
| `audio.ts` | 音声処理 |
| `vtt.ts` | VTT 字幕フォーマット変換 |
| `description.ts` | 概要欄テキスト処理 |
| `itunes.ts` | iTunes/Apple Podcasts 連携 |
| `spotify.ts` | Spotify API 連携 |

## Cron ジョブ

Worker は 5分ごとに `handleScheduledPublish` を実行します。

```
毎5分:
  1. index.json から scheduledEpisodeIds を取得
  2. 各エピソードの publishAt を確認
  3. 時刻を過ぎていれば publishStatus を "published" に更新
  4. index.json を更新
  5. RSS フィードを再生成
  6. 公開サイトのリビルドをトリガー（WEB_DEPLOY_HOOK_URL）
  7. Bluesky へ投稿（blueskyPostEnabled が true の場合）
```

## データフロー

### エピソード作成〜公開

```
管理画面
  │
  ├─ POST /api/episodes          # エピソード作成 (publishStatus: "new")
  │
  ├─ POST /api/episodes/:id/upload-url   # Presigned URL 発行
  │
  ├─ PUT (R2 直接アップロード)   # ブラウザ → R2
  │
  ├─ POST /api/episodes/:id/upload-complete  # 完了通知 (publishStatus: "draft")
  │
  ├─ PUT /api/episodes/:id       # 公開日時設定 (publishStatus: "scheduled")
  │
  └─ [Cron: 5分ごと]            # 自動公開 (publishStatus: "published")
       └─ Web リビルドトリガー
```
