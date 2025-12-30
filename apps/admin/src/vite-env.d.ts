/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Worker API のベースURL */
  readonly VITE_API_BASE: string;
  /** プレビュー環境用の Worker API ベースURL (オプション) */
  readonly VITE_PREVIEW_API_BASE?: string;
  /** ローカル開発時の Web サイトベースURL (オプション) */
  readonly VITE_WEB_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
