---
title: 概要
description: Imagecaster とは何か、どんな構成で動いているか
sidebar:
  order: 1
---

Imagecaster は、Cloudflare のインフラ上で完全にセルフホストできる Podcast 配信システムです。

## アーキテクチャ概要

```
リスナー
  └─ 公開サイト (Astro SSG / Cloudflare Pages)
       └─ 音声・RSS (Cloudflare R2)

管理者
  └─ 管理画面 (React + Vite / Cloudflare Pages)
       └─ API (Cloudflare Workers + Hono)
            └─ ストレージ (Cloudflare R2)
```

### 3つのアプリケーション

| アプリ | 場所 | 役割 |
|--------|------|------|
| `apps/worker` | Cloudflare Workers | REST API、スケジュール実行（Cron） |
| `apps/web` | Cloudflare Pages | リスナー向け公開サイト（SSG） |
| `apps/admin` | Cloudflare Pages | 管理者向けダッシュボード（SPA） |

## モノレポ構成

```
imagecaster/
├── apps/
│   ├── admin/        # 管理画面（React + Vite + Tailwind）
│   ├── web/          # 公開サイト（Astro SSG + Tailwind）
│   ├── worker/       # API + Cron（Cloudflare Workers + Hono）
│   └── docs/         # このドキュメントサイト（Astro Starlight）
├── docs/             # セットアップ手順など（Markdown）
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

パッケージマネージャーは **pnpm**、ビルドオーケストレーターは **Turborepo** を使用しています。

## データの流れ

### エピソード公開の流れ

1. 管理者が管理画面でエピソードを作成
2. 音声ファイルを R2 にアップロード（Presigned URL 経由）
3. （オプション）文字起こしサービスへ自動送信
4. 公開予約日時になると Worker の Cron が自動で公開処理
5. 公開をトリガーに Astro の SSG サイトをリビルド
6. リスナーが公開サイトで視聴

### 静的サイト生成

公開サイト（`apps/web`）はビルド時に R2 から `index.json` を読み込み、静的 HTML を生成します。エピソードの追加・更新・削除のたびに自動リビルドされます（デプロイフック経由）。

## 次のステップ

- [セットアップ](../setup/) — 一からの構築手順
- [全体アーキテクチャ](../../architecture/overview/) — 詳細な設計
