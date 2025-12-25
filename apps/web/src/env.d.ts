/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly R2_PUBLIC_URL: string;
  readonly SITE_TITLE: string;
  readonly FEED_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
