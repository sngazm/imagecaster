---
title: 環境変数リファレンス
description: Worker と Admin の環境変数一覧
sidebar:
  order: 2
---

## Worker 環境変数

`wrangler.toml` または Cloudflare Dashboard の **Variables and Secrets** で設定します。

### 必須

| 変数名 | 説明 | 例 |
|--------|------|----|
| `PODCAST_TITLE` | 番組名 | `My Podcast` |
| `WEBSITE_URL` | 公開サイト URL | `https://your-podcast.example.com` |
| `R2_ACCOUNT_ID` | Cloudflare Account ID | `abc123...` (32文字) |
| `R2_BUCKET_NAME` | R2 バケット名 | `podcast-bucket` |
| `R2_PUBLIC_URL` | R2 パブリック URL | `https://pub-xxx.r2.dev` |
| `CF_ACCESS_TEAM_DOMAIN` | Access チームドメイン | `yourteam.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | Access AUD Tag | `abc123...` |

### シークレット（必須）

| 変数名 | 説明 |
|--------|------|
| `R2_ACCESS_KEY_ID` | R2 API Key ID |
| `R2_SECRET_ACCESS_KEY` | R2 API Secret |

### オプション

| 変数名 | 説明 |
|--------|------|
| `WEB_DEPLOY_HOOK_URL` | Pages デプロイフック URL（公開時の自動リビルド） |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token（ビルド状況表示用） |
| `PAGES_PROJECT_NAME` | Pages プロジェクト名（ビルド状況表示用） |
| `BLUESKY_IDENTIFIER` | Bluesky ハンドル（Bluesky 連携用） |
| `BLUESKY_PASSWORD` | Bluesky アプリパスワード（Bluesky 連携用） |
| `SPOTIFY_CLIENT_ID` | Spotify Client ID（Spotify 連携用） |
| `SPOTIFY_CLIENT_SECRET` | Spotify Client Secret（Spotify 連携用） |

### 開発用

| 変数名 | 説明 |
|--------|------|
| `IS_DEV` | `true` の場合、JWT 認証をスキップ（**本番では絶対に使用しない**） |

## Admin（Cloudflare Pages Functions）

Admin は Vite のプロキシ設定と Worker のルーティングで `/api/*` を Worker に転送します。
追加の環境変数は不要です。

## ローカル開発

`apps/worker/.dev.vars` に設定します（`.gitignore` 済み）。

```ini
PODCAST_TITLE=番組名
WEBSITE_URL=https://your-podcast.example.com

R2_ACCOUNT_ID=<Account ID>
R2_BUCKET_NAME=podcast-bucket-dev
R2_PUBLIC_URL=https://pub-xxx.r2.dev

CF_ACCESS_TEAM_DOMAIN=your-team.cloudflareaccess.com
CF_ACCESS_AUD=<AUD Tag>

IS_DEV=true

R2_ACCESS_KEY_ID=<Access Key ID>
R2_SECRET_ACCESS_KEY=<Secret Access Key>
```

`.dev.vars.example` をコピーして作成してください:

```bash
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
```

## 設定値の取得場所

| 設定項目 | 取得場所 |
|---------|---------|
| Account ID | Cloudflare ダッシュボード右サイドバー |
| R2 Public URL | R2 バケット → Settings → Public access |
| CF Access Team Domain | Zero Trust → 設定 |
| CF Access AUD | Access → Applications → アプリ詳細 |
| R2 Access Key ID / Secret | R2 API Token 作成時（一度しか表示されない） |
| WEB_DEPLOY_HOOK_URL | Pages → Settings → Builds & deployments → Deploy hooks |
| CLOUDFLARE_API_TOKEN | Cloudflare API Tokens ページで作成 |
