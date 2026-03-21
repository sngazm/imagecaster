---
title: ローカル開発
description: ローカル開発環境のセットアップと開発コマンド
sidebar:
  order: 1
---

## 前提条件

- Node.js 18 以上
- pnpm（`npm install -g pnpm`）
- cloudflared（R2 バインディング用）

```bash
brew install cloudflared   # macOS
```

## セットアップ

```bash
# 依存関係インストール
pnpm install

# .dev.vars を作成（Worker の環境変数）
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
# .dev.vars を編集して値を設定
```

## 開発コマンド

```bash
# 全サービスを同時起動
pnpm dev

# 個別に起動
pnpm dev:worker   # http://localhost:8787
pnpm dev:admin    # http://localhost:5173
pnpm dev:web      # http://localhost:4321
pnpm dev:docs     # http://localhost:4322（このドキュメントサイト）
```

## ポート一覧

| サービス | ポート |
|---------|--------|
| Worker API | 8787 |
| 管理画面 | 5173 |
| 公開サイト | 4321 |
| ドキュメント | 4322 |

## 開発時の認証

`.dev.vars` に `IS_DEV=true` を設定すると、JWT 認証をスキップします。ローカルでは認証なしで API を叩けます。

管理画面（`localhost:5173`）は `IS_DEV=true` の Worker（`localhost:8787`）に直接 API リクエストを送ります。

## R2 へのアクセス

ローカル開発時は `wrangler.toml` の `remote = true` 設定により、実際の R2（開発用バケット）に接続します。これには cloudflared が必要です。

```toml
[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "podcast-bucket-dev"
preview_bucket_name = "podcast-bucket-dev"
remote = true   # ← これがローカルからリモート R2 への接続を許可
```

## ビルド

```bash
pnpm build        # 全体ビルド
pnpm build:web    # 公開サイトのみ
pnpm build:admin  # 管理画面のみ
```

## デプロイ（手動）

```bash
pnpm deploy:worker  # Worker を本番環境にデプロイ
pnpm deploy:admin   # 管理画面を本番環境にデプロイ
pnpm deploy:web     # 公開サイトを本番環境にデプロイ
```
