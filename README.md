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
│   ├── web/            # 公開サイト（Astro SSG）※未実装
│   └── worker/         # API + Cron（Cloudflare Workers + Hono）
├── packages/
│   ├── shared/         # 共通型定義 ※未実装
│   └── rss-generator/  # RSSフィード生成 ※未実装
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

## セットアップ

### 1. 依存関係のインストール

```bash
pnpm install
```

### 2. Cloudflare R2 バケット作成

```bash
# Cloudflare ダッシュボードまたは Wrangler CLI で作成
wrangler r2 bucket create podcast-bucket
wrangler r2 bucket create podcast-bucket-dev  # 開発用

# CORS 設定を適用（ブラウザからのアップロード・再生に必要）
wrangler r2 bucket cors put podcast-bucket --file apps/worker/r2-cors.json
```

### 3. R2 API トークン作成

Cloudflare ダッシュボード → R2 → Manage R2 API Tokens で作成:
- 権限: Object Read & Write
- バケット: 作成したバケットを指定

### 4. Worker シークレット設定

```bash
cd apps/worker

# R2 認証情報
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY

# Deploy Hook（任意、後述）
wrangler secret put WEB_DEPLOY_HOOK_URL
```

### 5. Cloudflare Access 設定

1. [Zero Trust ダッシュボード](https://one.dash.cloudflare.com/) でアプリケーション作成
2. Worker と Pages のドメインを保護対象に設定
3. 認証ポリシー設定（メール、Google 等）
4. AUD を `wrangler.toml` の `CF_ACCESS_AUD` に設定

## 開発

```bash
# 全体開発サーバー
pnpm dev

# 個別起動
pnpm dev:worker   # Worker（localhost:8787）
pnpm dev:admin    # 管理画面（localhost:5173）

# ビルド
pnpm build

# 型チェック
pnpm typecheck
```

### ローカル開発時の認証スキップ

開発環境では `wrangler.toml` の `[dev]` セクションに以下を追加:

```toml
[dev.vars]
SKIP_AUTH = "true"
```

## デプロイ

### Worker

```bash
pnpm deploy:worker
# または
cd apps/worker && wrangler deploy
```

### Admin（Cloudflare Pages）

1. GitHub リポジトリを Cloudflare Pages に接続
2. ビルド設定:
   - Framework preset: `None`
   - Build command: `pnpm build:admin`
   - Build output directory: `apps/admin/dist`
   - Root directory: `/`
3. 環境変数:
   - `VITE_API_BASE`: Worker の URL（例: `https://podcast-worker.xxx.workers.dev`）

### Web（Cloudflare Pages）

1. 別の Pages プロジェクトとして作成
2. ビルド設定:
   - Framework preset: `Astro`
   - Build command: `pnpm build:web`
   - Build output directory: `apps/web/dist`

## Deploy Hook（自動リビルド）

エピソードが公開されたとき、Web サイトを自動でリビルドする機能。

### 設定手順

1. **Cloudflare Pages で Deploy Hook を作成**
   - Pages プロジェクト → Settings → Builds & deployments → Deploy Hooks
   - "Add deploy hook" をクリック
   - 名前（例: `worker-trigger`）を入力して作成
   - 発行された URL をコピー

2. **Worker に設定**
   ```bash
   cd apps/worker
   wrangler secret put WEB_DEPLOY_HOOK_URL
   # プロンプトでコピーした URL を入力
   ```

### 動作フロー

```
Cron（5分毎）
    │
    ▼
予約済みエピソードをチェック
    │
    ▼ （公開時刻を過ぎたものがあれば）
    │
ステータスを published に変更
    │
    ▼
RSS フィード再生成
    │
    ▼
Deploy Hook を呼び出し ──▶ Web サイト自動リビルド
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
| POST | /api/episodes/:id/upload-from-url | 必要 | URL から取得 |
| POST | /api/episodes/:id/transcription-complete | 必要 | 文字起こし完了 |

## エピソードのライフサイクル

```
┌─────────┐     POST /api/episodes
│  draft  │◀────────────────────────
└────┬────┘     （メタデータのみ作成）
     │
     │ POST /api/episodes/:id/upload-url
     │ → Presigned URL で音声アップロード
     │ POST /api/episodes/:id/upload-complete
     ▼
┌───────────┐
│ uploading │
└─────┬─────┘
      │
      ├─────────────────────────────────┐
      │ skipTranscription: false        │ skipTranscription: true
      ▼                                 │
┌──────────────┐                        │
│ transcribing │                        │
└──────┬───────┘                        │
       │                                │
       │ POST /.../transcription-complete
       ▼                                ▼
┌───────────┐                    ┌───────────┐
│ scheduled │◀───────────────────│ scheduled │
└─────┬─────┘                    └─────┬─────┘
      │                                │
      │ Cron: publishAt を過ぎたら     │
      ▼                                ▼
┌───────────┐                    ┌───────────┐
│ published │                    │ published │
└───────────┘                    └───────────┘
```

## R2 バケット構造

```
podcast-bucket/
├── episodes/
│   └── ep-001/
│       ├── meta.json       # メタデータ
│       ├── audio.mp3       # 音声ファイル
│       └── transcript.vtt  # 文字起こし（任意）
├── index.json              # エピソード一覧インデックス
├── feed.xml                # RSS フィード（キャッシュ）
└── assets/
    └── artwork.jpg         # カバーアート
```

## 環境変数

### Worker（wrangler.toml）

| 変数名 | 説明 |
|--------|------|
| PODCAST_TITLE | 番組名 |
| WEBSITE_URL | 公開サイト URL |
| R2_ACCOUNT_ID | Cloudflare アカウント ID |
| R2_BUCKET_NAME | R2 バケット名 |
| CF_ACCESS_TEAM_DOMAIN | Access チームドメイン |
| CF_ACCESS_AUD | Access アプリケーション AUD |

### Worker（secrets）

| 変数名 | 説明 |
|--------|------|
| R2_ACCESS_KEY_ID | R2 API キー ID |
| R2_SECRET_ACCESS_KEY | R2 API シークレット |
| WEB_DEPLOY_HOOK_URL | Deploy Hook URL（任意） |

### Admin（.env）

| 変数名 | 説明 |
|--------|------|
| VITE_API_BASE | Worker の URL |

## ライセンス

MIT
