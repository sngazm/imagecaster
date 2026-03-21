---
title: デプロイガイド
description: Imagecaster の本番環境へのデプロイ手順
sidebar:
  order: 1
---

import { Aside } from '@astrojs/starlight/components';

## GitHub Actions によるデプロイ（推奨）

<Aside type="note">
Cloudflare の GitHub 連携には環境変数がデプロイ時に消えるバグがあるため、GitHub Actions での手動デプロイを推奨します。
参考: [Issue #8871](https://github.com/cloudflare/workers-sdk/issues/8871)
</Aside>

### 1. Cloudflare の GitHub 連携を無効化

Cloudflare Dashboard → Workers & Pages → `imagecaster-api` → Settings → Builds & deployments → **Disconnect**

### 2. GitHub Secrets / Variables を設定

**Settings → Secrets and variables → Actions** で設定します。

**Variables（テキスト）:**

| 変数名 | 例 |
|--------|----|
| `PODCAST_TITLE` | `My Podcast` |
| `WEBSITE_URL` | `https://your-website.com` |
| `R2_BUCKET_NAME` | `podcast-bucket` |
| `R2_PUBLIC_URL` | `https://pub-xxx.r2.dev` |
| `CF_ACCESS_TEAM_DOMAIN` | `yourteam.cloudflareaccess.com` |
| `PAGES_PROJECT_NAME` | `podcast-web` |

**Secrets（暗号化）:**

| シークレット名 | 説明 |
|----------------|------|
| `CLOUDFLARE_API_TOKEN` | Workers デプロイ用 API Token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |
| `R2_ACCOUNT_ID` | R2 Account ID |
| `R2_ACCESS_KEY_ID` | R2 API Key ID |
| `R2_SECRET_ACCESS_KEY` | R2 API Secret |
| `CF_ACCESS_AUD` | Cloudflare Access AUD Tag |
| `WEB_DEPLOY_HOOK_URL` | Pages デプロイフック URL（オプション） |
| `WORKER_CLOUDFLARE_API_TOKEN` | Worker 内で使う API Token（オプション） |
| `BLUESKY_IDENTIFIER` | Bluesky ハンドル（オプション） |
| `BLUESKY_PASSWORD` | Bluesky アプリパスワード（オプション） |
| `SPOTIFY_CLIENT_ID` | Spotify Client ID（オプション） |
| `SPOTIFY_CLIENT_SECRET` | Spotify Client Secret（オプション） |

### 3. デプロイの動作

| トリガー | 動作 |
|---------|------|
| `main` ブランチへの push | 本番環境にデプロイ |
| PR / その他のブランチ | プレビュー環境にデプロイ |
| 手動実行（workflow_dispatch） | 任意のタイミングでデプロイ |

プレビュー環境は `imagecaster-api-preview.<subdomain>.workers.dev` でアクセスできます。

---

## 手動デプロイ

GitHub Actions を使わない場合:

```bash
# Worker をデプロイ
pnpm deploy:worker

# 管理画面をデプロイ
pnpm deploy:admin

# 公開サイトをデプロイ
pnpm deploy:web
```

---

## Web サイト自動デプロイの設定

エピソードの公開・更新・削除時に自動で Web サイトをリビルドするには、Cloudflare Pages のデプロイフックを設定します。

1. Cloudflare Dashboard → Workers & Pages → Web サイトのプロジェクト
2. **Settings** → **Builds & deployments** → **Deploy hooks** → **Add deploy hook**
3. 名前（例: `podcast-worker`）とブランチ（通常は `main`）を入力
4. 表示された URL をコピー

```bash
npx wrangler secret put WEB_DEPLOY_HOOK_URL
# プロンプトで URL を入力
```

---

## ビルド状況表示の設定

管理画面でビルドの進捗を確認するには Cloudflare API Token が必要です。

1. [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens) → **Create Token**
2. Permissions: `Account > Cloudflare Pages > Read`
3. トークンをコピー

```bash
npx wrangler secret put CLOUDFLARE_API_TOKEN
npx wrangler secret put PAGES_PROJECT_NAME   # 例: podcast-web
```
