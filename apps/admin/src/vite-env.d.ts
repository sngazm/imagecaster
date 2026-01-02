/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** ローカル開発時の Web サイトベースURL (オプション) */
  readonly VITE_WEB_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
