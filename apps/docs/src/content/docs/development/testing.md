---
title: テスト
description: Worker API のテスト実行方法
sidebar:
  order: 2
---

## テストの実行

```bash
# Worker API のテスト
cd apps/worker && pnpm test

# または、プロジェクトルートから
pnpm test
```

`apps/web` と `apps/admin` にはテストがないため、Worker のみのテストとなります。

## テストファイルの場所

`apps/worker/src/__tests__/` 配下:

| ファイル | 内容 |
|---------|------|
| `index.test.ts` | ヘルスチェック、404 ハンドラー |
| `episodes.test.ts` | エピソード CRUD、文字起こし完了 |
| `upload.test.ts` | アップロード関連 |
| `settings.test.ts` | 設定管理 |
| `templates.test.ts` | テンプレート CRUD |
| `import.test.ts` | RSS インポート、デプロイ状況 |
| `transcription.test.ts` | 文字起こしキュー |
| `audio.test.ts` | 音声処理 |
| `podcast.test.ts` | Podcast メタデータ |
| `feed.test.ts` | RSS フィード生成 |
| `spotify.test.ts` | Spotify 連携 |
| `backup.test.ts` | バックアップ |

## テスト環境

Vitest + `@cloudflare/vitest-pool-workers` を使用しています。Cloudflare Workers のランタイム環境でテストが実行されます。

## 新機能追加時

1. 機能を実装
2. `apps/worker/src/__tests__/` 配下に対応するテストを追加
3. `pnpm test` で全テストが通ることを確認
4. コミット
