# podcast-platform

セルフホスト型 Podcast 配信システム。Cloudflare のエコシステムを活用したフルスタック構成。

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Cloudflare Access                                │
│                    (認証: メール / Google / Service Token)                │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
        ▼                           ▼                           ▼
┌───────────────┐         ┌─────────────────┐         ┌───────────────┐
│  apps/admin   │         │   apps/worker   │         │   apps/web    │
│  (React+Vite) │ ──API──▶│ (Hono+Workers)  │◀──fetch─│  (Astro SSG)  │
│               │         │                 │         │               │
│ Cloudflare    │         │ Cloudflare      │         │ Cloudflare    │
│ Pages         │         │ Workers         │         │ Pages         │
└───────────────┘         └────────┬────────┘         └───────────────┘
                                   │                          ▲
                                   │ R2 Binding               │
                                   ▼                          │
                          ┌─────────────────┐                 │
                          │  Cloudflare R2  │                 │
                          │                 │    Deploy Hook  │
                          │ - episodes/     │─────────────────┘
                          │ - index.json    │   (エピソード公開時)
                          │ - feed.xml      │
                          └─────────────────┘
```

## 技術スタック

| レイヤー | 技術 | 用途 |
|---------|------|------|
| パッケージ管理 | pnpm + Turborepo | モノレポ管理 |
| API | Cloudflare Workers + Hono | REST API + Cron |
| 公開サイト | Astro (SSG) | リスナー向けサイト |
| 管理画面 | React + Vite + Tailwind CSS | エピソード管理 |
| ストレージ | Cloudflare R2 | 音声・メタデータ保存 |
| 認証 | Cloudflare Access | JWT ベース認証 |
| ホスティング | Cloudflare Pages | 静的サイト配信 |

## ディレクトリ構成

```
podcast-platform/
├── apps/
│   ├── admin/          # 管理画面（React + Vite + Tailwind）
│   ├── web/            # 公開サイト（Astro SSG + Tailwind）
│   └── worker/         # API + Cron（Cloudflare Workers + Hono）
├── packages/
│   ├── shared/         # 共通型定義 ※未実装
│   └── rss-generator/  # RSSフィード生成 ※未実装
├── docs/
│   └── SETUP.md        # 詳細なセットアップ手順
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

## クイックスタート

詳細な手順は **[docs/SETUP.md](docs/SETUP.md)** を参照してください。

```bash
# 依存関係のインストール
pnpm install

# 開発サーバー起動
pnpm dev
```

## 開発コマンド

```bash
pnpm dev           # 全体開発サーバー
pnpm dev:worker    # Worker（localhost:8787）
pnpm dev:admin     # 管理画面（localhost:5173）
pnpm dev:web       # 公開サイト（localhost:4321）
pnpm build         # ビルド
pnpm test          # Worker API テスト
pnpm deploy:worker # Worker デプロイ
```

## API エンドポイント

| Method | Path | 認証 | 説明 |
|--------|------|------|------|
| GET | /feed.xml | 不要 | RSS フィード |
| GET | /health | 不要 | ヘルスチェック |
| GET | /api/episodes | 必要 | エピソード一覧 |
| GET | /api/episodes/:id | 必要 | エピソード詳細 |
| POST | /api/episodes | 必要 | 新規作成 |
| PUT | /api/episodes/:id | 必要 | 更新 |
| DELETE | /api/episodes/:id | 必要 | 削除 |
| POST | /api/episodes/:id/upload-url | 必要 | Presigned URL 発行 |
| POST | /api/episodes/:id/upload-complete | 必要 | アップロード完了通知 |

## ドキュメント

- **[docs/SETUP.md](docs/SETUP.md)** - セットアップガイド（R2, Access, Worker 設定）

## ライセンス

MIT
