import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// GitHub Pages へのデプロイ時は環境変数で上書きされる
// SITE=https://sngazm.github.io BASE_PATH=/imagecaster
const site = process.env.SITE ?? 'http://localhost:4322';
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  site,
  base,
  integrations: [
    starlight({
      title: 'Imagecaster',
      description: 'セルフホスト型 Podcast 配信システムのドキュメント',
      defaultLocale: 'ja',
      locales: {
        root: {
          label: '日本語',
          lang: 'ja',
        },
      },
      social: {
        github: 'https://github.com/sngazm/imagecaster',
      },
      sidebar: [
        {
          label: 'はじめに',
          items: [
            { label: '概要', slug: 'getting-started/overview' },
            { label: 'セットアップ', slug: 'getting-started/setup' },
          ],
        },
        {
          label: 'アーキテクチャ',
          items: [
            { label: '全体構成', slug: 'architecture/overview' },
            { label: 'ストレージ (R2)', slug: 'architecture/storage' },
            { label: '認証 (Cloudflare Access)', slug: 'architecture/auth' },
            { label: 'エピソードのライフサイクル', slug: 'architecture/episode-lifecycle' },
          ],
        },
        {
          label: 'API リファレンス',
          items: [
            { label: 'エピソード', slug: 'api/episodes' },
            { label: 'アップロード', slug: 'api/upload' },
            { label: '設定', slug: 'api/settings' },
            { label: 'テンプレート', slug: 'api/templates' },
            { label: 'インポート', slug: 'api/import' },
          ],
        },
        {
          label: '機能',
          items: [
            { label: '文字起こし', slug: 'features/transcription' },
            { label: 'Bluesky 連携', slug: 'features/bluesky' },
            { label: 'RSS フィード', slug: 'features/rss' },
            { label: 'バックアップ', slug: 'features/backup' },
            { label: 'Spotify 連携', slug: 'features/spotify' },
          ],
        },
        {
          label: 'デプロイ',
          items: [
            { label: 'デプロイガイド', slug: 'deployment/guide' },
            { label: '環境変数リファレンス', slug: 'deployment/env-vars' },
          ],
        },
        {
          label: '開発',
          items: [
            { label: 'ローカル開発', slug: 'development/local' },
            { label: 'テスト', slug: 'development/testing' },
          ],
        },
      ],
    }),
  ],
});
