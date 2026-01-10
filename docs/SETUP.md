# Podcast Platform セットアップガイド

このドキュメントでは、Podcast Platform を一から構築する手順を説明します。

## 目次

1. [前提条件](#前提条件)
2. [リポジトリのセットアップ](#リポジトリのセットアップ)
3. [Cloudflare R2 の設定](#cloudflare-r2-の設定)
4. [Cloudflare Access の設定](#cloudflare-access-の設定)
5. [Worker の設定](#worker-の設定)
6. [ローカル開発環境の設定](#ローカル開発環境の設定)
7. [本番デプロイ](#本番デプロイ)
8. [トラブルシューティング](#トラブルシューティング)

---

## 前提条件

以下がインストールされていること:

- Node.js 18+
- pnpm (`npm install -g pnpm`)
- Cloudflare アカウント（無料プランで可）
- cloudflared（ローカル開発用）

### cloudflared のインストール

ローカル開発でリモート R2 バケットにアクセスするために `cloudflared` が必要です。

```bash
# macOS (Homebrew)
brew install cloudflared

# その他の OS は公式ドキュメントを参照
# https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
```

> **Note**: `wrangler dev` で `remote = true` の R2 バインディングを使用する場合に cloudflared が必要になります。
> Presigned URL（S3 API）経由のアクセスとは異なり、R2 バインディング経由でリモート R2 に接続するにはこれが必須です。
> なぜ必要かの詳細な理由は不明ですが、Wrangler がこれを要求します。詳しい方は Issue で教えてください。

---

## リポジトリのセットアップ

```bash
# リポジトリをクローン
git clone https://github.com/your-username/podcast-platform.git
cd podcast-platform

# 依存関係をインストール
pnpm install
```

---

## Cloudflare R2 の設定

### 1. R2 を有効化

1. [Cloudflare ダッシュボード](https://dash.cloudflare.com/) にログイン
2. 左メニューから **R2** を選択
3. 初回の場合は R2 を有効化（クレジットカード登録が必要だが、無料枠あり）

### 2. バケットを作成

**本番用バケット:**

1. **Create bucket** をクリック
2. **Bucket name**: `podcast-bucket`（任意の名前）
3. **Location**: お好みのリージョン
4. **Create bucket** をクリック

**開発用バケット:**

1. 同様に `podcast-bucket-dev` を作成

### 3. CORS 設定を適用

ブラウザからのアップロード・再生に必要です。`apps/worker/r2-cors.json` に設定が用意されています。

```bash
cd apps/worker
wrangler r2 bucket cors set podcast-bucket --file r2-cors.json
wrangler r2 bucket cors set podcast-bucket-dev --file r2-cors.json
```

この設定では:
- **GET/HEAD**: 全オリジン許可（ポッドキャストアプリ、Web プレイヤー向け）
- **PUT**: 管理画面のオリジンのみ許可（セキュリティのため）

### 4. R2 API Token を作成

Presigned URL の生成に必要です。

1. R2 ダッシュボードで右側の **Manage R2 API Tokens** をクリック
   - または **Account Details** → **API Tokens** → **Manage**
2. **Create API Token** をクリック
3. 設定:
   - **Token name**: `podcast-platform`（任意）
   - **Permissions**: `Object Read & Write`
   - **Specify bucket(s)**: `All buckets` または特定のバケットを選択
   - **TTL**: 必要に応じて設定
4. **Create API Token** をクリック
5. 表示された値を**必ずメモ**（この画面を閉じると二度と表示されません）:
   - **Access Key ID**
   - **Secret Access Key**

### 5. Account ID を確認

1. Cloudflare ダッシュボードの任意のページ
2. 右側サイドバーに **Account ID** が表示されている
3. この値をメモ（32文字の英数字）

### 6. パブリックアクセスを有効化

音声ファイルをブラウザから直接再生できるようにするため、R2 のパブリックアクセスを有効にします。

**本番用バケット:**

1. R2 ダッシュボードで `podcast-bucket` を選択
2. **Settings** タブを開く
3. **Public access** セクションで **Allow Access** をクリック
4. 確認ダイアログで有効化
5. 表示される **Public Bucket URL**（`https://pub-xxxxxxxx.r2.dev` 形式）をメモ

**開発用バケット:**

1. 同様に `podcast-bucket-dev` でもパブリックアクセスを有効化
2. 開発用の Public Bucket URL をメモ（`.dev.vars` に設定）

> **Note**: パブリックアクセスを有効にすると、バケット内のファイルは URL を知っていれば誰でもアクセス可能になります。
> 音声ファイルを公開配信するポッドキャストでは問題ありませんが、機密ファイルは別バケットで管理してください。

---

## Cloudflare Access の設定

管理画面の認証に使用します。

### ⚠️ 重要: Admin と Worker を同一アプリケーションに登録

**異なるドメイン間で SSO を有効にするため、Admin と Worker を同一の Access アプリケーションに登録する必要があります。**

別々のアプリケーションにすると:
- AUD（Audience）が異なる
- JWT 検証が失敗する
- CORS エラーや 401 エラーが発生する

### 同一ドメインで運用（サブディレクトリ構成）

Worker の `wrangler.toml` で `routes` を設定し、Admin Pages のサブディレクトリとして API を配置します：

```
admin.yourdomain.com      → Admin (Cloudflare Pages)
admin.yourdomain.com/api  → Worker（routes 設定で同一ドメインにマウント）
```

### 1. Zero Trust ダッシュボードにアクセス

1. Cloudflare ダッシュボード左メニューから **Zero Trust** を選択
2. 初回の場合はチーム名を設定（例: `myteam`）
   - これが `myteam.cloudflareaccess.com` のようなドメインになります

### 2. アプリケーションを作成

1. **Access** → **Applications** を選択
2. **Add an application** をクリック
3. **Self-hosted** を選択

### 3. アプリケーション設定

**Configure app:**

1. **Application name**: `Podcast Platform`（任意）
2. **Session Duration**: お好みで設定
3. **Application domain に両方追加:**
   - Admin: `xxx.pages.dev`
   - Worker: `podcast-worker.xxx.workers.dev`
4. **Next** をクリック

**Add policies:**

1. **Policy name**: `Allow Admins`（任意）
2. **Action**: `Allow`
3. **Configure rules**:
   - **Selector**: `Emails`
   - **Value**: 許可するメールアドレス
   - または **Selector**: `Emails ending in` で `@your-domain.com` など
4. **Next** をクリック

**Setup / CORS 設定:**

1. **「オリジンへのオプション リクエストをバイパスする」を ON** にする
   - これをしないと CORS preflight が失敗します
2. **Add application** をクリック

### 4. AUD を確認

1. 作成したアプリケーションの詳細を開く
2. **Overview** タブ
3. **Application Audience (AUD) Tag** をメモ
4. **この AUD を Worker の `CF_ACCESS_AUD` に設定**

### 5. Team Domain を確認

1. **Settings** → **Custom Pages** または
2. Zero Trust ダッシュボードの URL から確認
   - `https://one.dash.cloudflare.com/<account-id>/<team-name>/...`
   - Team Domain は `<team-name>.cloudflareaccess.com`

### 6. Google アカウントでログインできるようにする（オプション）

メールアドレス認証の代わりに Google アカウントでログインできるようにするには、以下のドキュメントを参照してください:

https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/

---

## Worker の設定

### 1. 本番環境の環境変数を設定

Cloudflare Dashboard で環境変数を設定します:

1. [Cloudflare ダッシュボード](https://dash.cloudflare.com/) にログイン
2. **Workers & Pages** → Worker プロジェクトを選択
3. **Settings** → **Variables and Secrets** を開く
4. **Add** をクリックして以下の変数を追加:

| 変数名 | 値 |
|--------|-----|
| `PODCAST_TITLE` | あなたの番組名 |
| `WEBSITE_URL` | https://your-website.com |
| `R2_ACCOUNT_ID` | あなたのAccount ID（32文字の英数字） |
| `R2_BUCKET_NAME` | podcast-bucket |
| `R2_PUBLIC_URL` | https://pub-xxxxxxxx.r2.dev（R2パブリックアクセスURL） |
| `CF_ACCESS_TEAM_DOMAIN` | your-team.cloudflareaccess.com |
| `CF_ACCESS_AUD` | あなたのAUD Tag |

> **Note**: `wrangler.toml` には環境変数の値を直接書かず、Cloudflare Dashboard で管理することでセキュリティを確保しています。

### 2. シークレットを設定（本番用）

```bash
cd apps/worker

# R2 API Token を設定
npx wrangler secret put R2_ACCESS_KEY_ID
# プロンプトで Access Key ID を入力

npx wrangler secret put R2_SECRET_ACCESS_KEY
# プロンプトで Secret Access Key を入力
```

### 3. Web サイト自動デプロイの設定（オプション）

エピソードの公開・更新・削除時に自動で Web サイト（Astro SSG）をリビルドするには、Cloudflare Pages のデプロイフックを設定します。

**デプロイフックの作成:**

1. Cloudflare ダッシュボードで **Workers & Pages** を選択
2. Web サイトのプロジェクトを選択
3. **Settings** → **Builds & deployments** を開く
4. **Deploy hooks** セクションで **Add deploy hook** をクリック
5. 名前を入力（例: `podcast-worker`）
6. ブランチを選択（通常は `main`）
7. **Add** をクリック
8. 表示された URL をコピー

**Worker にフックを設定:**

```bash
npx wrangler secret put WEB_DEPLOY_HOOK_URL
# プロンプトでデプロイフック URL を入力
```

**動作:**
- エピソードが公開（published）されたとき
- 公開済みエピソードが更新されたとき
- 公開済みエピソードが削除されたとき
- スケジュール配信で公開されたとき（5分ごとの cron）

上記のタイミングで自動的に Web サイトがリビルドされます。

### 4. ビルド状況表示の設定（オプション）

管理画面でビルドの進捗状況を確認するには、Cloudflare API Token を設定します。

**API Token の作成:**

1. [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens) にアクセス
2. **Create Token** をクリック
3. **Create Custom Token** を選択
4. 設定:
   - **Token name**: `podcast-admin-pages-read`（任意）
   - **Permissions**:
     - Account > Cloudflare Pages > Read
   - **Account Resources**: 対象のアカウントを選択
5. **Continue to summary** → **Create Token**
6. 表示されたトークンをコピー

**Worker にトークンを設定:**

```bash
npx wrangler secret put CLOUDFLARE_API_TOKEN
# プロンプトで API Token を入力

npx wrangler secret put PAGES_PROJECT_NAME
# プロンプトで Web サイトのプロジェクト名を入力（例: podcast-web）
```

設定後、管理画面のヘッダーにビルド状況が表示されます:
- ビルド中: 青いスピナーと「ビルド中」表示
- 成功: 緑のチェックマークと「完了」表示
- 失敗: 赤の×マークと「失敗」表示

クリックすると最近5件のデプロイ履歴が確認できます。

### 5. Spotify 連携の設定（オプション）

Spotify のエピソード URL を自動取得するには、Spotify Developer アプリの認証情報が必要です。

> **Note**: 2026年1月現在、Spotify Developer の新規アプリ登録が一時停止されています。既存のアプリがある場合のみ設定可能です。

**Spotify Developer アプリの作成:**

1. [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) にアクセス
2. **Create app** をクリック
3. アプリ名と説明を入力
4. **Redirect URIs** に任意の URL を入力（実際には使用しません）
5. **Web API** にチェックを入れる
6. 利用規約に同意して作成
7. **Settings** から **Client ID** と **Client secret** をコピー

**Worker にシークレットを設定:**

```bash
npx wrangler secret put SPOTIFY_CLIENT_ID
# プロンプトで Client ID を入力

npx wrangler secret put SPOTIFY_CLIENT_SECRET
# プロンプトで Client secret を入力
```

**設定後の動作:**
- 管理画面の設定 → Spotify 連携セクションが有効になります
- Spotify Show ID を設定し、自動取得を有効にすると、公開から1日以上経ったエピソードの Spotify URL が自動取得されます

---

## ローカル開発環境の設定

### 1. .dev.vars を作成

`apps/worker/.dev.vars.example` をコピーして `.dev.vars` を作成:

```bash
cd apps/worker
cp .dev.vars.example .dev.vars
```

`.dev.vars` を編集して値を設定:

```bash
# Podcast 設定
PODCAST_TITLE=番組名
WEBSITE_URL=https://your-podcast.example.com

# Cloudflare R2
R2_ACCOUNT_ID=あなたのAccount ID
R2_BUCKET_NAME=podcast-bucket-dev
R2_PUBLIC_URL=https://pub-xxxxxxxx.r2.dev

# Cloudflare Access (JWT認証用)
CF_ACCESS_TEAM_DOMAIN=your-team.cloudflareaccess.com
CF_ACCESS_AUD=あなたのAUD Tag

# 開発モード（認証をスキップ）
IS_DEV=true

# R2 API Token（Presigned URL 生成に必要）
R2_ACCESS_KEY_ID=あなたのAccess Key ID
R2_SECRET_ACCESS_KEY=あなたのSecret Access Key
```

> **Note**: `.dev.vars` は `.gitignore` に含まれているため、リポジトリにコミットされません。

### 2. 開発サーバーを起動

```bash
# プロジェクトルートで
pnpm dev

# または個別に起動
pnpm dev:worker   # http://localhost:8787
pnpm dev:admin    # http://localhost:5173
```

### 3. 動作確認

1. ブラウザで http://localhost:5173 を開く
2. タイトルと音声ファイルを入力
3. 「登録」ボタンをクリック
4. 成功メッセージが表示されれば OK

---

## 本番デプロイ

### 1. Worker をデプロイ

```bash
pnpm deploy:worker
```

### 2. Admin をデプロイ

```bash
pnpm deploy:admin
```

### 3. 本番用バケットの CORS 設定

セットアップ時に `r2-cors.json` を適用済みであれば、追加設定は不要です。

---

## トラブルシューティング

### CORS エラーが発生する

**症状**: `Access to fetch has been blocked by CORS policy`

**解決策**:
1. R2 バケットの CORS 設定を確認（`wrangler r2 bucket cors list podcast-bucket`）
2. Cloudflare Access で「オリジンへのオプション リクエストをバイパスする」が ON か確認

### 401 Unauthorized: Missing Access token

**症状**: `Unauthorized: Missing Access token`

**解決策**:
- ローカル開発時: `.dev.vars` に `IS_DEV=true` があるか確認
- 本番: Cloudflare Access でログインしているか確認

### 401 Unauthorized: Invalid token

**症状**: `Unauthorized: Invalid token`

**解決策**:
1. **Admin と Worker が同一の Access アプリケーションに登録されているか確認**
2. `CF_ACCESS_AUD` が正しいか確認（Access アプリケーションの AUD と完全一致）
3. Worker を再デプロイ（`wrangler deploy`）

### Episode not found エラー

**症状**: エピソード作成後に `Episode not found`

**解決策**:
1. Worker のログを確認
2. R2 API Token が正しく設定されているか確認
3. `.dev.vars` の設定を確認

### ERR_SSL_VERSION_OR_CIPHER_MISMATCH

**症状**: R2 へのアップロード時に SSL エラー

**解決策**:
- R2 の URL 形式が正しいか確認
- 正しい形式: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com/<BUCKET>/<KEY>`
- 間違い: `https://<BUCKET>.<ACCOUNT_ID>.r2.cloudflarestorage.com/<KEY>`

### ローカルで R2 ファイルが見つからない

**症状**: `Audio file not found in R2`

**解決策**:
1. `wrangler.toml` の R2 バインディングに `remote = true` が設定されているか確認
2. `cloudflared` がインストールされているか確認（`cloudflared --version`）
3. それでも発生する場合は `IS_DEV=true` が設定されていれば、この確認はスキップされます

**背景**:
- `remote = true` なしの場合、R2 Binding はローカルエミュレーターを参照します
- Presigned URL は S3 API 経由で実際の R2 にアップロードするため、不整合が発生していました
- `remote = true` を設定すると、R2 Binding も実際の R2（dev bucket）に接続します

---

## 設定値の一覧

| 設定項目 | 取得場所 | 設定場所 |
|---------|---------|---------|
| Account ID | Cloudflare ダッシュボード右側 | Dashboard / .dev.vars |
| R2 Bucket Name | R2 ダッシュボード | Dashboard / .dev.vars |
| R2 Public URL | R2 バケット Settings → Public access | Dashboard / .dev.vars |
| CF Access Team Domain | Zero Trust 設定 | Dashboard / .dev.vars |
| CF Access AUD | Access Application 詳細 | Dashboard / .dev.vars |
| R2 Access Key ID | R2 API Token 作成時 | .dev.vars / wrangler secret |
| R2 Secret Access Key | R2 API Token 作成時 | .dev.vars / wrangler secret |
| WEB_DEPLOY_HOOK_URL | Pages Settings → Deploy hooks | wrangler secret（オプション）|
| CLOUDFLARE_API_TOKEN | API Tokens ページで作成 | wrangler secret（オプション）|
| PAGES_PROJECT_NAME | Workers & Pages プロジェクト名 | wrangler secret（オプション）|
| SPOTIFY_CLIENT_ID | Spotify Developer Dashboard | wrangler secret（オプション）|
| SPOTIFY_CLIENT_SECRET | Spotify Developer Dashboard | wrangler secret（オプション）|

> **Note**: 「Dashboard」は Cloudflare Dashboard の Workers & Pages > Settings > Variables and Secrets を指します。

---

## 参考リンク

- [Cloudflare R2 ドキュメント](https://developers.cloudflare.com/r2/)
- [Cloudflare Access ドキュメント](https://developers.cloudflare.com/cloudflare-one/policies/access/)
- [Cloudflare Access + Google 認証](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/)
- [Wrangler ドキュメント](https://developers.cloudflare.com/workers/wrangler/)
