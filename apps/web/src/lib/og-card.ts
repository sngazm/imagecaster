/**
 * OGP 画像に載せる中身の型
 *
 * 描く側（og-image.ts）は sharp を読み込むので、ページから使う型と定数はここに分ける。
 */

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/** 見た目を変えたら上げる。SNS 側のキャッシュを外すために URL に混ぜる */
export const OG_DESIGN_VERSION = 1;

export interface OgCard {
  /** 上に小さく出す。エピソード番号など */
  eyebrow?: string;
  title: string;
  /** タイトルの下に出す。番組のひとことなど */
  subtitle?: string;
  /** 下段の左。番組名 */
  footerLeft?: string;
  /** 下段の右。公開日や長さ */
  footerRight?: string;
  /** 先頭から順に試し、取れたものを使う */
  artworkUrls: Array<string | null | undefined>;
}
