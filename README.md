# Imagecaster

セルフホスト型 Podcast 配信システム。Cloudflare のエコシステムを活用したフルスタック構成。

## 特徴

- **完全セルフホスト**: Cloudflare のサービスのみで完結
- **低コスト運用**: Workers と R2 の無料枠で小規模運用可能
- **自動公開**: 予約投稿、Bluesky 自動投稿対応
- **RSSフィード**: Apple Podcasts, Spotify 等に対応

## アーキテクチャ

```
┌────────────────────────────────────┐
│        Cloudflare Access           │
│  (認証: メール / Google / Token)    │
└────────────────────────────────────┘
        │                   │
        ▼                   ▼
┌───────────────┐   ┌─────────────────┐            ┌───────────────┐
│  apps/admin   │   │   apps/worker   │──Pages API─▶│  apps/web    │
│  (React+Vite) │──▶│ (Hono+Workers)  │  (rebuild)  │  (Astro SSG)  │
│               │API│                 │            │               │
│ CF Pages      │   │ CF Workers      │            │ CF Pages      │
│ (認証必要)     │   │ (認証必要)       │            │ (公開)        │
└───────────────┘   └────────┬────────┘            └───────┬───────┘
                             │                             │
                             │ R2 Binding                  │ fetch (build時)
                             ▼                             ▼
                    ┌─────────────────────────────────────────┐
                    │              Cloudflare R2              │
                    │                                         │
                    │  - episodes/{id}/meta.json, audio.mp3   │
                    │  - index.json                           │
                    │  - feed.xml                             │
                    └─────────────────────────────────────────┘
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
- エピソード別アートワークの設定

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

### 外部プラットフォーム連携
- **Apple Podcasts リンク自動取得**: iTunes Search API を使用してエピソードごとのリンクを自動取得
  - 管理画面起動時にバックグラウンドで自動実行
  - タスクトレイで進捗状況を確認可能
- **Spotify リンク**: Podcast ページへのリンクを設定可能
- 公開サイトのエピソードページに各プラットフォームへのリンクを表示

### デプロイ連携
- エピソード公開時に Web サイトを自動リビルド
- デプロイ状況の確認

## API エンドポイント

### 公開エンドポイント（認証不要）

| Method | Path | 説明 |
|--------|------|------|
| GET | /api/health | ヘルスチェック |

※ RSSフィード (`/feed.xml`) は Pages で静的配信

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

## R2 ストレージと未公開エピソードの隠蔽

エピソードの音声ファイルは R2 に保存され、公開 URL でアクセスできます。未公開エピソードの音声 URL が推測されないよう、以下の仕組みで保護しています。

### storageKey によるURL推測防止

各エピソードは `{slug}-{ランダム文字列}` 形式の `storageKey` を持ちます。

```
episodes/
├── my-episode-a3x8k9m2/     ← storageKey: "my-episode-a3x8k9m2"
│   ├── meta.json
│   └── audio.mp3             ← URL: https://r2.example.com/episodes/my-episode-a3x8k9m2/audio.mp3
```

slug だけでは音声 URL を組み立てられないため、`storageKey` を知らない限りアクセスできません。

### index.json の役割

`index.json` は R2 に保存され、公開サイト（Astro SSG）のビルド時に読み込まれます。

```jsonc
{
  "podcast": { /* 番組設定 */ },
  "episodes": [
    // published のエピソードのみ（storageKey を含む）
    { "id": "ep-1", "storageKey": "ep-1-a3x8k9m2" }
  ],
  "scheduledEpisodeIds": [
    // scheduled のエピソード ID のみ（storageKey は含まない）
    "ep-2"
  ]
}
```

| フィールド | 内容 | storageKey | 用途 |
|-----------|------|-----------|------|
| `episodes` | 公開済みエピソード | 含む | Web ビルド・RSS フィード生成 |
| `scheduledEpisodeIds` | 予約投稿待ちの ID 一覧 | **含まない** | Cron の公開チェック最適化 |

- `episodes` に `storageKey` を含めるのは、公開済みなので音声 URL が公開情報であるため
- `scheduledEpisodeIds` に `storageKey` を含めないのは、未公開エピソードの音声 URL を隠蔽するため

### Cron による予約公開の流れ

```
Cron (5分ごと)
  ├─ index.json から scheduledEpisodeIds を取得
  ├─ 各 ID の meta.json を読み込み（findEpisodeBySlug）
  ├─ publishAt ≤ 現在時刻 なら公開処理
  │   ├─ publishStatus を "published" に変更
  │   ├─ scheduledEpisodeIds から除去、episodes に追加
  │   ├─ Bluesky 自動投稿（設定時）
  │   └─ RSS フィード再生成 + Web リビルド
  └─ 対象なし → 何もしない（R2 操作は index.json の読み込み 1回のみ）
```

### syncPublishedIndex の動作

エピソードのステータスが変わるたびに `syncPublishedIndex()` が呼ばれ、`index.json` を更新します。

| ステータス変更 | episodes | scheduledEpisodeIds |
|--------------|----------|---------------------|
| → `published` | 追加 | 除去 |
| → `scheduled` | 除去 | 追加 |
| → その他 | 除去 | 除去 |

## 認証

Cloudflare Access を使用した JWT ベース認証。

### ブラウザ（管理画面）
- Cloudflare Access でログイン（メール認証 / Google 等）
- リクエストに `Cf-Access-Jwt-Assertion` ヘッダーが自動付与

### スクリプト連携
- Cloudflare Access の Service Token を使用
- `CF-Access-Client-Id` / `CF-Access-Client-Secret` ヘッダーを付与

## 概算費用

Cloudflare R2 は**エグレス（帯域幅）が無料**のため、ポッドキャスト配信に最適です。

### 料金体系（2025年現在）

| サービス | 無料枠 | 超過分 |
|---------|--------|--------|
| R2 ストレージ | 10GB/月 | $0.015/GB/月 |
| R2 Class B操作（読み取り） | 1,000万回/月 | $0.36/100万回 |
| R2 エグレス（帯域幅） | **無制限** | **無料** |
| Workers リクエスト | 10万回/日 | $5/月〜 |
| Pages | 無制限帯域 | 無料 |

### シナリオ1: 小規模ポッドキャスト

**条件**: 1時間100MBのエピソード × 100本、月1,000ダウンロード

| 項目 | 使用量 | 費用 |
|------|--------|------|
| ストレージ | 10GB | $0（無料枠内） |
| 帯域幅 | 100GB/月 | $0（R2は無料） |
| API操作 | 1,000回/月 | $0（無料枠内） |
| Workers | 1,000回/月 | $0（無料枠内） |
| **合計** | | **$0/月** |

### シナリオ2: 大規模ポッドキャスト

**条件**: 1時間100MBのエピソード × 1,000本、月100,000ダウンロード

| 項目 | 使用量 | 費用 |
|------|--------|------|
| ストレージ | 100GB | $1.35/月（90GB × $0.015） |
| 帯域幅 | 10TB/月 | $0（R2は無料） |
| API操作 | 100,000回/月 | $0（無料枠内） |
| Workers | 100,000回/月 | $0〜$5（ピーク時考慮で有料推奨） |
| **合計** | | **約$1.35〜$6.35/月** |

### 参考: 他サービスとの比較（シナリオ2の場合）

| サービス | ストレージ | 帯域幅（10TB） | 合計 |
|---------|-----------|----------------|------|
| **Cloudflare R2** | $1.35 | **$0** | **約$1〜$6/月** |
| AWS S3 + CloudFront | $2.30 | $850+ | $850+/月 |
| Google Cloud Storage | $2.30 | $120+ | $120+/月 |

> **Note**: Cloudflare R2 の無料エグレスにより、大規模配信でも月額数ドルで運用可能です。

## ドキュメント

- **[docs/SETUP.md](docs/SETUP.md)** - 詳細なセットアップガイド
  - Cloudflare R2 の設定
  - Cloudflare Access の設定
  - Worker のデプロイ
  - 環境変数の設定

## ライセンス

MIT
