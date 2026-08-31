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
    └── {storageKey}/            # 例: episode-title-abc123
        ├── meta.json            # エピソードメタデータ
        ├── audio.mp3            # 音声ファイル
        ├── tracks.zip           # 話者ごとに分かれた音声トラック（任意）
        ├── transcript.raw.json  # Whisper の生出力（後処理の入力）
        ├── transcript.json      # 後処理済み（統合・誤字修正後）
        ├── transcript.vtt       # 字幕（公開サイトが読む）
        ├── artwork.jpg          # エピソード固有のアートワーク（任意）
        └── clips/               # 切り抜き動画（任意）
            ├── index.json       # この回の切り抜き一覧
            └── {clipId}/
                ├── meta.json    # 区間・版の一覧・状態・直しの指示
                └── v{n}/
                    ├── clip.mp4      # その版の動画
                    ├── subs.json     # その版で実際に描かれた字幕
                    ├── cards.json    # その版で出した画像
                    └── manifest.json # 画像の出どころ
```

### 文字起こしの 3 つのファイル

`transcript.raw.json` は Whisper が出したままのデータで、後処理をやり直すための入力として
残しておきます。統合の条件や誤字の辞書を変えたときに、文字起こしを実行し直さずに
`transcript.json` と `transcript.vtt` を作り直せるのはこのためです。

`tracks.zip` は話者判定にのみ使うので、文字起こしが済んだら削除してかまいません。

### 切り抜き動画の版

`clips/{clipId}/v{n}/` は**上書きしません**。作り直しても前の版が残ります。見比べたい
のと、悪くなったときに戻れるようにするためです。

動画は手元（WSL）で描かれ、Presigned URL で直に R2 へ入ります。数十 MB を Worker に
流す理由がないためで、音声・アートワーク・話者トラックと同じ扱いです。読むときも
公開 URL から直接で、Worker を通しません。

詳しくは [切り抜き動画 API](/api/clips/) を参照してください。

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
