---
title: セットアップ
description: Imagecaster を一から構築するための手順
sidebar:
  order: 2
---

import { Steps, Aside } from '@astrojs/starlight/components';

## 前提条件

- Node.js 18 以上
- pnpm（`npm install -g pnpm`）
- Cloudflare アカウント（無料プランで可）
- cloudflared（ローカル開発用）

```bash
# macOS
brew install cloudflared
```

<Aside type="note">
`wrangler dev` でリモートの R2 バケットを使う場合に cloudflared が必要です。
</Aside>

## リポジトリのセットアップ

```bash
git clone https://github.com/sngazm/imagecaster.git
cd imagecaster
pnpm install
```

## Cloudflare R2 の設定

<Steps>

1. **R2 を有効化**

   [Cloudflare ダッシュボード](https://dash.cloudflare.com/) → **R2** → R2 を有効化（クレジットカード登録が必要、無料枠あり）

2. **バケットを作成**

   - 本番用: `podcast-bucket`
   - 開発用: `podcast-bucket-dev`

3. **CORS 設定を適用**

   ```bash
   cd apps/worker
   wrangler r2 bucket cors set podcast-bucket --file r2-cors.json
   wrangler r2 bucket cors set podcast-bucket-dev --file r2-cors.json
   ```

4. **R2 API Token を作成**

   R2 ダッシュボード → **Manage R2 API Tokens** → **Create API Token**
   - Permissions: `Object Read & Write`
   - 表示された **Access Key ID** と **Secret Access Key** をメモ

5. **パブリックアクセスを有効化**

   各バケットの **Settings** → **Public access** → **Allow Access**
   - 表示される Public Bucket URL（`https://pub-xxxxxxxx.r2.dev`）をメモ

</Steps>

## Cloudflare Access の設定

<Aside type="caution">
**Admin と Worker を必ず同一の Access アプリケーションに登録してください。**
別々にすると AUD が異なり JWT 検証が失敗します。
</Aside>

<Steps>

1. **Zero Trust ダッシュボードにアクセス**

   Cloudflare ダッシュボード → **Zero Trust**

2. **アプリケーションを作成**

   **Access** → **Applications** → **Add an application** → **Self-hosted**

3. **Application domain に両方追加**

   - Admin の Pages ドメイン（例: `xxx.pages.dev`）
   - Worker のドメイン（例: `caster.image.club`）

4. **CORS 設定**

   「オリジンへのオプションリクエストをバイパスする」を **ON** に設定

5. **AUD と Team Domain をメモ**

   アプリケーションの Overview → **Application Audience (AUD) Tag**

</Steps>

## Worker の設定

### ローカル開発用 `.dev.vars`

```bash
cd apps/worker
cp .dev.vars.example .dev.vars
```

`.dev.vars` を編集:

```ini
PODCAST_TITLE=番組名
WEBSITE_URL=https://your-podcast.example.com

R2_ACCOUNT_ID=<Account ID>
R2_BUCKET_NAME=podcast-bucket-dev
R2_PUBLIC_URL=https://pub-xxxxxxxx.r2.dev

CF_ACCESS_TEAM_DOMAIN=your-team.cloudflareaccess.com
CF_ACCESS_AUD=<AUD Tag>

IS_DEV=true

R2_ACCESS_KEY_ID=<Access Key ID>
R2_SECRET_ACCESS_KEY=<Secret Access Key>
```

### 本番用シークレットを設定

```bash
cd apps/worker
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
```

## 開発サーバーを起動

```bash
# プロジェクトルートで（全サービス同時起動）
pnpm dev

# 個別に起動
pnpm dev:worker   # http://localhost:8787
pnpm dev:admin    # http://localhost:5173
pnpm dev:web      # http://localhost:4321
```

## 本番デプロイ

### GitHub Actions（推奨）

リポジトリの **Settings** → **Secrets and variables** → **Actions** で以下を設定します。

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
| `CLOUDFLARE_API_TOKEN` | Workers デプロイ用 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |
| `R2_ACCOUNT_ID` | R2 Account ID |
| `R2_ACCESS_KEY_ID` | R2 API Key ID |
| `R2_SECRET_ACCESS_KEY` | R2 API Secret |
| `CF_ACCESS_AUD` | Cloudflare Access AUD Tag |

main ブランチへの push で本番環境に、PR/その他のブランチではプレビュー環境にデプロイされます。

## トラブルシューティング

### CORS エラー

1. R2 バケットの CORS 設定を確認: `wrangler r2 bucket cors list podcast-bucket`
2. Cloudflare Access で「オリジンへのオプションリクエストをバイパスする」が ON か確認

### 401 Unauthorized: Missing Access token

ローカル開発時: `.dev.vars` に `IS_DEV=true` があるか確認

### 401 Unauthorized: Invalid token

1. Admin と Worker が同一の Access アプリケーションに登録されているか確認
2. `CF_ACCESS_AUD` が正しいか確認
