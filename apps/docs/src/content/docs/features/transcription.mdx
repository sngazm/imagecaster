---
title: 文字起こし
description: 外部サービスとの連携による自動文字起こし
sidebar:
  order: 1
---

import { Aside } from '@astrojs/starlight/components';

Imagecaster は文字起こし機能を内蔵していません。外部の文字起こしサービスと連携するためのキューイング仕組みを提供しています。

## 仕組み

```
Worker                      外部文字起こしサービス
   │                                │
   │ アップロード完了後              │
   ├─ transcribeStatus: "pending"   │
   │                                │
   │◄─ GET /api/transcription/queue ┤  （定期ポーリング）
   │                                │
   ├─────────────────────────────► ─┤  音声ダウンロード
   │                                │  Whisper 等で処理
   │                                ├─ transcript.vtt を R2 に PUT
   │                                │
   │◄─ POST /api/episodes/:id/      │
   │       transcription-complete ──┤
   │                                │
   ├─ transcribeStatus: "completed" │
   └─ transcriptUrl を更新          │
```

## 文字起こしキュー API

### GET /api/transcription/queue

文字起こし待ちのエピソードを取得します。このエンドポイントを叩くことで、取得したエピソードにソフトロックが掛かります。

```typescript
interface TranscriptionQueueResponse {
  episodes: TranscriptionQueueItem[];
}

interface TranscriptionQueueItem {
  id: string;
  slug: string;
  title: string;
  audioUrl: string;
  sourceAudioUrl: string | null;
  duration: number;
  lockedAt: string;              // ロック取得時刻（1時間で自動解除）
}
```

### ソフトロック

- キューから取得したエピソードは `transcriptionLockedAt` がセットされる
- 他のサービスインスタンスが同じエピソードを二重処理しないための仕組み
- ロックは **1時間** で自動解除（タイムアウト時に `failed` ではなく `pending` に戻る）

### 完了通知

```
POST /api/episodes/:id/transcription-complete
```

```typescript
{
  transcribeStatus: "completed" | "failed",
  duration?: number,        // 音声の実際の長さ（秒）
  errorMessage?: string     // 失敗時のエラー内容
}
```

完了通知前に、文字起こしサービスは `transcript.vtt` を R2 の以下のパスに PUT してください:

```
episodes/{storageKey}/transcript.vtt
```

### リトライ

`transcribeStatus: "failed"` のエピソードは、管理画面または API からリトライできます:

```
PUT /api/episodes/:id
{
  "transcribeStatus": "pending"
}
```

## VTT フォーマット

```
WEBVTT

00:00:00.000 --> 00:00:05.000
こんにちは、このポッドキャストへようこそ。

00:00:05.000 --> 00:00:10.000
今回のテーマは...
```

## skipTranscription オプション

エピソード作成時に `skipTranscription: true` を指定すると、文字起こしをスキップできます。

```json
POST /api/episodes
{
  "title": "第1回",
  "skipTranscription": true
}
```

この場合、`transcribeStatus` は `skipped` のままになり、キューには追加されません。

## hideTranscription オプション

`hideTranscription: true` を設定すると、文字起こしが完了していても公開サイトに表示されません。

```
PUT /api/episodes/:id
{
  "hideTranscription": true
}
```

<Aside type="note">
文字起こしサービスの実装例については `docs/TRANSCRIBER.md` を参照してください。
</Aside>
