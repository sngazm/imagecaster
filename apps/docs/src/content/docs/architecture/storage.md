---
title: ストレージ (R2)
description: Cloudflare R2 のバケット構造とデータ形式
sidebar:
  order: 2
---

Imagecaster はデータベースを使わず、すべてのデータを **Cloudflare R2** に保存します。

## バケット構造

```
podcast-bucket/
├── index.json              # Podcast 全体のインデックス
├── feed.xml                # RSS フィード（生成済み）
├── templates.json          # 概要欄テンプレート一覧
├── assets/
│   └── artwork.jpg         # Podcast カバーアート
└── episodes/
    └── {storageKey}/       # 例: episode-title-abc123
        ├── meta.json       # エピソードメタデータ
        ├── audio.mp3       # 音声ファイル
        ├── transcript.vtt  # 字幕（文字起こし済みの場合）
        └── artwork.jpg     # エピソード固有のアートワーク（任意）
```

### storageKey について

`storageKey` は `{slug}-{ランダム文字列}` 形式のディレクトリ名です。slug だけではなくランダム文字列を付加することで、URL を知らない第三者がファイルパスを推測できないようにしています。

## index.json

Podcast 全体のインデックスファイル。公開済みエピソードの一覧と Podcast 設定を含みます。

```typescript
interface PodcastIndex {
  podcast: {
    title: string;
    description: string;
    author: string;
    email: string;
    language: string;
    category: string;
    artworkUrl: string;
    websiteUrl: string;
    explicit: boolean;
    applePodcastsId: string | null;
    applePodcastsAutoFetch: boolean;
    spotifyShowId: string | null;
    spotifyAutoFetch: boolean;
    applePodcastsUrl?: string;
    spotifyUrl?: string;
  };
  episodes: Array<{
    id: string;
    storageKey: string;
  }>;
  scheduledEpisodeIds?: string[];  // Cron 最適化用
}
```

`episodes` 配列には **published** なエピソードのみ含まれます。`scheduledEpisodeIds` は Cron が確認すべきエピソードを絞り込むためのキャッシュです。

## meta.json（エピソード）

各エピソードディレクトリに存在するメタデータファイル。

```typescript
interface EpisodeMeta {
  id: string;
  slug: string;
  storageKey: string;
  title: string;
  description: string;       // HTML
  duration: number;          // 秒
  fileSize: number;          // バイト
  audioUrl: string;          // R2 パブリック URL
  sourceAudioUrl: string | null;
  sourceGuid: string | null;
  transcriptUrl: string | null;
  artworkUrl: string | null;
  skipTranscription: boolean;
  hideTranscription?: boolean;
  publishStatus: PublishStatus;
  transcribeStatus: TranscribeStatus;
  createdAt: string;         // ISO 8601
  publishAt: string | null;
  publishedAt: string | null;
  blueskyPostText: string | null;
  blueskyPostEnabled: boolean;
  blueskyPostedAt: string | null;
  referenceLinks: ReferenceLink[];
  applePodcastsUrl: string | null;
  spotifyUrl: string | null;
  transcriptionLockedAt?: string | null;
  transcriptionErrorMessage?: string | null;
}
```

## ステータス値

### publishStatus

| 値 | 説明 |
|----|------|
| `new` | 作成直後（音声なし） |
| `uploading` | 音声アップロード / ダウンロード中 |
| `draft` | 音声あり、公開予約なし |
| `scheduled` | 公開予約済み |
| `published` | 公開済み |

### transcribeStatus

| 値 | 説明 |
|----|------|
| `none` | 文字起こし未開始 |
| `pending` | キュー待ち |
| `transcribing` | 文字起こし中 |
| `completed` | 完了 |
| `failed` | 失敗 |
| `skipped` | スキップ（skipTranscription: true） |

## templates.json

```typescript
interface TemplatesIndex {
  templates: DescriptionTemplate[];
}

interface DescriptionTemplate {
  id: string;
  name: string;
  content: string;   // HTML
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}
```

## R2 アクセス方式

Worker は 2 つの方法で R2 にアクセスします。

| 用途 | 方式 |
|------|------|
| メタデータの読み書き | R2 Binding（`env.R2_BUCKET`） |
| 音声ファイルのアップロード | S3 API 経由の Presigned URL（ブラウザから直接アップロード） |

Presigned URL 方式では、音声ファイルは Worker を経由せず直接 R2 にアップロードされます。これにより Worker の CPU 時間とメモリ消費を最小化しています。
