import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: process.env.SITE_URL || 'http://localhost:4321',
  // 開発時はSSR、本番は静的生成
  output: process.env.NODE_ENV === 'development' ? 'server' : 'static',
  vite: {
    plugins: [tailwindcss()],
  },
});
