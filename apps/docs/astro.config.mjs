import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
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
            { label: '概要', link: '/getting-started/overview/' },
            { label: 'セットアップ', link: '/getting-started/setup/' },
          ],
        },
        {
          label: 'アーキテクチャ',
          items: [
            { label: '全体構成', link: '/architecture/overview/' },
            { label: 'ストレージ (R2)', link: '/architecture/storage/' },
            { label: '認証 (Cloudflare Access)', link: '/architecture/auth/' },
            { label: 'エピソードのライフサイクル', link: '/architecture/episode-lifecycle/' },
          ],
        },
        {
          label: 'API リファレンス',
          items: [
            { label: 'エピソード', link: '/api/episodes/' },
            { label: 'アップロード', link: '/api/upload/' },
            { label: '設定', link: '/api/settings/' },
            { label: 'テンプレート', link: '/api/templates/' },
            { label: 'インポート', link: '/api/import/' },
          ],
        },
        {
          label: '機能',
          items: [
            { label: '文字起こし', link: '/features/transcription/' },
            { label: 'Bluesky 連携', link: '/features/bluesky/' },
            { label: 'RSS フィード', link: '/features/rss/' },
            { label: 'バックアップ', link: '/features/backup/' },
            { label: 'Spotify 連携', link: '/features/spotify/' },
          ],
        },
        {
          label: 'デプロイ',
          items: [
            { label: 'デプロイガイド', link: '/deployment/guide/' },
            { label: '環境変数リファレンス', link: '/deployment/env-vars/' },
          ],
        },
        {
          label: '開発',
          items: [
            { label: 'ローカル開発', link: '/development/local/' },
            { label: 'テスト', link: '/development/testing/' },
          ],
        },
      ],
    }),
  ],
});
