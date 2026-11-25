/**
 * OGP 画像に載せる中身の型
 *
 * 描く側（og-image.ts）は sharp を読み込むので、ページから使う型と定数はここに分ける。
 */

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/** 見た目を変えたら上げる。SNS 側のキャッシュを外すために URL に混ぜる */
export const OG_DESIGN_VERSION = 2;

export interface OgCard {
  /** 上に小さく出す。エピソード番号など */
  eyebrow?: string;
  title: string;
  /** タイトルの下に出す。番組のひとことなど */
  subtitle?: string;
  /** 番号の横に出す。番組名 */
  label?: string;
  /** タイトルの下に出す。公開日や長さ */
  meta?: string;
  /** 先頭から順に試し、取れたものを使う */
  artworkUrls: Array<string | null | undefined>;
}
