# podcast-platform

セルフホスト型 Podcast 配信システム。Turborepo モノレポ構成。

## ディレクトリ構成

```
podcast-platform/
├── apps/
│   ├── admin/          # 管理画面（React + Vite）
│   ├── web/            # 公開サイト（Astro SSG）※未実装
│   └── worker/         # API + Cron（Cloudflare Workers + Hono）
├── packages/
│   ├── shared/         # 共通型定義 ※未実装
│   └── rss-generator/  # RSSフィード生成 ※未実装
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| パッケージ管理 | pnpm + Turborepo |
| API | Cloudflare Workers (Hono) |
| 公開サイト | Astro (SSG) |
| 管理画面 | React + Vite |
| ストレージ | Cloudflare R2 |
| 認証 | Cloudflare Access |
| ホスティング | Cloudflare Pages |

## 認証方式

**Cloudflare Access** に一元化。APIキーは使わない。

### ブラウザ（管理画面）
- Cloudflare Access でログイン（メール認証/Google等）
- リクエストに `Cf-Access-Jwt-Assertion` ヘッダーが自動付与
- Worker側でJWTを検証

### スクリプト（transcriber等）
- Cloudflare Access の **Service Token** を使用
- リクエストに以下のヘッダーを付与:
  - `CF-Access-Client-Id`
  - `CF-Access-Client-Secret`

### Worker側の検証
```typescript
import { createRemoteJWKSet, jwtVerify } from 'jose';

const JWKS = createRemoteJWKSet(
  new URL(`https://${TEAM_DOMAIN}/cdn-cgi/access/certs`)
);

// Cf-Access-Jwt-Assertion ヘッダーを検証
await jwtVerify(jwt, JWKS, { audience: ACCESS_AUD });
```

## API エンドポイント

| Method | Path | 説明 |
|--------|------|------|
| GET | /api/episodes | エピソード一覧 |
| GET | /api/episodes/:id | エピソード詳細 |
| POST | /api/episodes | 新規作成（メタデータのみ、status: draft） |
| PUT | /api/episodes/:id | 更新 |
| DELETE | /api/episodes/:id | 削除 |
| POST | /api/episodes/:id/upload-url | Presigned URL 発行 |
| POST | /api/episodes/:id/upload-complete | アップロード完了通知 |
| POST | /api/episodes/:id/upload-from-url | URL から取得 |
| POST | /api/episodes/:id/transcription-complete | 文字起こし完了 |
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
# 依存関係インストール
pnpm install

# 全体開発サーバー
pnpm dev

# 個別起動
pnpm dev:worker   # Worker（localhost:8787）
pnpm dev:admin    # 管理画面（localhost:5173）

# ビルド
pnpm build

# デプロイ
pnpm deploy:worker
pnpm deploy:admin
```

## 環境変数

### Worker (wrangler.toml の vars)
- `PODCAST_TITLE` - 番組名
- `WEBSITE_URL` - 公開サイトURL
- `R2_ACCOUNT_ID` - CloudflareアカウントID
- `R2_BUCKET_NAME` - R2バケット名
- `CF_ACCESS_TEAM_DOMAIN` - Access チームドメイン（例: myteam.cloudflareaccess.com）
- `CF_ACCESS_AUD` - Access アプリケーションの AUD

### Worker (secrets) - `wrangler secret put` で設定
- `R2_ACCESS_KEY_ID` - R2 APIキーID
- `R2_SECRET_ACCESS_KEY` - R2 APIシークレット

### Admin (.env)
- `VITE_API_BASE` - Worker の URL

## R2 バケット構造

```
podcast-bucket/
├── episodes/
│   └── ep-001/
│       ├── meta.json       # メタデータ
│       ├── audio.mp3       # 音声
│       └── transcript.vtt  # 文字起こし
├── index.json              # エピソード一覧
├── feed.xml                # RSSフィード
└── assets/
    └── artwork.jpg         # カバーアート
```

## Cloudflare Access 設定手順

### 重要: Admin と Worker を同一アプリケーションに登録

異なるドメイン間で SSO を有効にするため、**Admin と Worker を同一の Access アプリケーション**に登録する必要がある。

1. Zero Trust ダッシュボードでアプリケーション作成
2. **Application domain に両方追加:**
   - Admin: `xxx.pages.dev`
   - Worker: `podcast-worker.xxx.workers.dev`
3. 認証ポリシー設定（メール、Google等）
4. **CORS 設定で「オリジンへのオプション リクエストをバイパスする」を ON**
5. Application Audience (AUD) をコピーして Worker の `CF_ACCESS_AUD` に設定
6. Service Token 作成（transcriber用）

### なぜ同一アプリケーションが必要か

- 別々のアプリケーションだと AUD が異なり、JWT 検証が失敗する
- 同一アプリケーションなら SSO が効き、Admin でログイン済みなら Worker へのリクエストも認証される
