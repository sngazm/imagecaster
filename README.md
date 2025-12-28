# Podcast Platform

セルフホスト型 Podcast 配信システム。Cloudflare のエコシステムを活用したフルスタック構成。

## 特徴

- **完全セルフホスト**: Cloudflare のサービスのみで完結
- **低コスト運用**: Workers と R2 の無料枠で小規模運用可能
- **自動公開**: 予約投稿、Bluesky 自動投稿対応
- **RSSフィード**: Apple Podcasts, Spotify 等に対応

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
| 公開サイト | Astro (SSG) + Tailwind CSS | リスナー向けサイト |
| 管理画面 | React + Vite + Tailwind CSS | エピソード管理 |
| ストレージ | Cloudflare R2 | 音声・メタデータ保存 |
| 認証 | Cloudflare Access | JWT ベース認証 |
| ホスティング | Cloudflare Pages | 静的サイト配信 |
| テスト | Vitest | Worker API テスト |

## ディレクトリ構成

```
podcast-platform/
├── apps/
│   ├── admin/          # 管理画面（React + Vite + Tailwind）
│   ├── web/            # 公開サイト（Astro SSG + Tailwind）
│   └── worker/         # API + Cron（Cloudflare Workers + Hono）
├── packages/           # 共通パッケージ（未実装）
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

# 開発サーバー起動（全アプリ同時起動）
pnpm dev

# 個別起動
pnpm dev:worker    # Worker（localhost:8787）
pnpm dev:admin     # 管理画面（localhost:5173）
pnpm dev:web       # 公開サイト（localhost:4321）
```

## 開発コマンド

| コマンド | 説明 |
|---------|------|
| `pnpm dev` | 全体開発サーバー |
| `pnpm build` | 本番ビルド |
| `pnpm test` | Worker API テスト |
| `pnpm deploy:worker` | Worker デプロイ |
| `pnpm deploy:admin` | 管理画面デプロイ |

## 機能一覧

### エピソード管理
- エピソードの作成・編集・削除
- 音声ファイルのアップロード（直接 or URL指定）
- 予約公開（publishAt 指定）
- 文字起こし連携（外部サービス経由）
- OGP画像の設定

### Podcast設定
- 番組タイトル・説明の編集
- カバーアート（Artwork）のアップロード
- カテゴリ・言語設定
- 明示的コンテンツフラグ

### テンプレート機能
- 説明文テンプレートの作成・管理
- プレースホルダー対応

### RSSインポート
- 既存のRSSフィードからエピソードをインポート
- プレビュー機能

### 自動投稿
- Bluesky への自動投稿（エピソード公開時）
- カスタム投稿テキスト設定

### デプロイ連携
- エピソード公開時に Web サイトを自動リビルド
- デプロイ状況の確認

## API エンドポイント

### 公開エンドポイント（認証不要）

| Method | Path | 説明 |
|--------|------|------|
| GET | /feed.xml | RSS フィード |
| GET | /health | ヘルスチェック |

### 認証必要エンドポイント

| Method | Path | 説明 |
|--------|------|------|
| GET/POST/PUT/DELETE | /api/episodes/* | エピソード管理 |
| GET/PUT | /api/settings | Podcast設定 |
| POST | /api/settings/artwork/* | アートワークアップロード |
| GET/POST/PUT/DELETE | /api/templates/* | テンプレート管理 |
| POST | /api/import/rss | RSSインポート |
| GET | /api/deployments | デプロイ状況 |

## エピソードのステータス

```
draft       → 下書き（未公開）
uploading   → 音声アップロード中
processing  → URL からダウンロード処理中
transcribing → 文字起こし処理中
scheduled   → 公開予約済み
published   → 公開済み
failed      → エラー発生
```

### ステータス遷移

```
文字起こしあり（skipTranscription: false）:
draft → uploading → transcribing → scheduled → published

文字起こしスキップ（skipTranscription: true）:
draft → uploading → scheduled → published
```

## 認証

Cloudflare Access を使用した JWT ベース認証。

### ブラウザ（管理画面）
- Cloudflare Access でログイン（メール認証 / Google 等）
- リクエストに `Cf-Access-Jwt-Assertion` ヘッダーが自動付与

### スクリプト連携
- Cloudflare Access の Service Token を使用
- `CF-Access-Client-Id` / `CF-Access-Client-Secret` ヘッダーを付与

## ドキュメント

- **[docs/SETUP.md](docs/SETUP.md)** - 詳細なセットアップガイド
  - Cloudflare R2 の設定
  - Cloudflare Access の設定
  - Worker のデプロイ
  - 環境変数の設定

## ライセンス

MIT
