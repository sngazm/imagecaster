# AI開発ガイドライン

このファイルはAIアシスタント向けの開発ガイドラインです。人間向けの仕様書は `README.md` を参照してください。

## プロジェクト概要

セルフホスト型 Podcast 配信システム。Turborepo モノレポ構成。

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
│   └── SETUP.md        # セットアップ手順
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

## 開発方針

### 変更時のテスト実行

**コードを変更したら必ずテストを実行すること。**

```bash
# Worker API のテスト
cd apps/worker && pnpm test

# または、プロジェクトルートから
pnpm test
```

### テストファイルの場所

- Worker API: `apps/worker/src/__tests__/`
  - `index.test.ts` - 基本的なヘルスチェック、404ハンドラ
  - `episodes.test.ts` - エピソードCRUD、文字起こし完了
  - `upload.test.ts` - アップロード関連
  - `settings.test.ts` - 設定管理
  - `templates.test.ts` - テンプレートCRUD
  - `import.test.ts` - RSSインポート、デプロイ状況

### 新機能追加時

1. 機能を実装
2. 対応するテストを追加（`apps/worker/src/__tests/` 配下）
3. `pnpm test` で全テストが通ることを確認
4. コミット

## 技術スタック

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

## 認証方式

**Cloudflare Access** に一元化。APIキーは使わない。

### Worker側の検証
```typescript
import { createRemoteJWKSet, jwtVerify } from 'jose';

const JWKS = createRemoteJWKSet(
  new URL(`https://${TEAM_DOMAIN}/cdn-cgi/access/certs`)
);

// Cf-Access-Jwt-Assertion ヘッダーを検証
await jwtVerify(jwt, JWKS, { audience: ACCESS_AUD });
```

開発モードでは `IS_DEV=true` で認証をスキップする。

## API エンドポイント

### Episodes
| Method | Path | 説明 |
|--------|------|------|
| GET | /api/episodes | エピソード一覧 |
| GET | /api/episodes/:id | エピソード詳細 |
| POST | /api/episodes | 新規作成 |
| PUT | /api/episodes/:id | 更新 |
| DELETE | /api/episodes/:id | 削除 |

### Upload
| Method | Path | 説明 |
|--------|------|------|
| POST | /api/episodes/:id/upload-url | Presigned URL 発行 |
| POST | /api/episodes/:id/upload-complete | アップロード完了通知 |
| POST | /api/episodes/:id/upload-from-url | URL から取得 |
| POST | /api/episodes/:id/transcription-complete | 文字起こし完了 |
| POST | /api/episodes/:id/og-image/upload-url | OG画像URL発行 |
| POST | /api/episodes/:id/og-image/upload-complete | OG画像完了通知 |

### Settings
| Method | Path | 説明 |
|--------|------|------|
| GET | /api/settings | 設定取得 |
| PUT | /api/settings | 設定更新 |
| POST | /api/settings/artwork/upload-url | アートワークURL発行 |
| POST | /api/settings/artwork/upload-complete | アートワーク完了通知 |
| POST | /api/settings/og-image/upload-url | OG画像URL発行 |
| POST | /api/settings/og-image/upload-complete | OG画像完了通知 |

### Templates
| Method | Path | 説明 |
|--------|------|------|
| GET | /api/templates | テンプレート一覧 |
| POST | /api/templates | テンプレート作成 |
| GET | /api/templates/:id | テンプレート詳細 |
| PUT | /api/templates/:id | テンプレート更新 |
| DELETE | /api/templates/:id | テンプレート削除 |

### Import / Other
| Method | Path | 説明 |
|--------|------|------|
| POST | /api/import/rss | RSSインポート |
| POST | /api/import/rss/preview | RSSプレビュー |
| GET | /api/deployments | デプロイ状況 |
| GET | /feed.xml | RSSフィード（認証不要） |
| GET | /health | ヘルスチェック（認証不要） |

## エピソードのステータス遷移

```
文字起こしあり（skipTranscription: false）:
draft → uploading → transcribing → scheduled → published

文字起こしスキップ（skipTranscription: true）:
draft → uploading → scheduled → published
```

## 開発コマンド

```bash
pnpm install          # 依存関係インストール
pnpm dev              # 全体開発サーバー
pnpm dev:worker       # Worker（localhost:8787）
pnpm dev:admin        # 管理画面（localhost:5173）
pnpm dev:web          # 公開サイト（localhost:4321）
pnpm build            # ビルド
pnpm test             # Worker API テスト
pnpm deploy:worker    # Worker デプロイ
pnpm deploy:admin     # 管理画面デプロイ
```

## R2 バケット構造

```
podcast-bucket/
├── episodes/
│   └── {slug}/
│       ├── meta.json       # メタデータ
│       ├── audio.mp3       # 音声
│       ├── transcript.vtt  # 文字起こし
│       └── og-image.jpg    # OG画像
├── templates.json          # テンプレート一覧
├── index.json              # エピソード一覧 + Podcast設定
├── feed.xml                # RSSフィード
└── assets/
    ├── artwork.jpg         # カバーアート
    └── og-image.jpg        # サイトOG画像
```

## 環境変数

### Worker (wrangler.toml)
- `IS_DEV` - 開発モード（認証スキップ）
- `WEBSITE_URL` - 公開サイトURL
- `R2_ACCOUNT_ID` - CloudflareアカウントID
- `R2_BUCKET_NAME` - R2バケット名
- `R2_PUBLIC_URL` - R2公開URL
- `CF_ACCESS_TEAM_DOMAIN` - Access チームドメイン
- `CF_ACCESS_AUD` - Access アプリケーションの AUD

### Worker (secrets)
- `R2_ACCESS_KEY_ID` - R2 APIキーID
- `R2_SECRET_ACCESS_KEY` - R2 APIシークレット
- `BLUESKY_IDENTIFIER` - Blueskyアカウント
- `BLUESKY_PASSWORD` - Blueskyアプリパスワード
- `CLOUDFLARE_API_TOKEN` - CF API トークン

### Admin (.env)
- `VITE_API_BASE` - Worker の URL

## 注意事項

- **Admin と Worker は同一の Access アプリケーションに登録が必要**（別々だと AUD が異なり認証失敗）
- 詳細な設定手順は **[docs/SETUP.md](docs/SETUP.md)** を参照
