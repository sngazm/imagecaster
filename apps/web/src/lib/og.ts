/**
 * OGP画像パスを解決するユーティリティ
 * ビルド時にダウンロードされたローカル画像を優先的に使用
 */

import { existsSync } from "fs";
import { join } from "path";

// ビルド時のファイルシステムチェック用
const publicDir = process.cwd().includes("/apps/web")
  ? join(process.cwd(), "public")
  : join(process.cwd(), "apps/web/public");

/**
 * ローカルのOGP画像パスを取得
 * ファイルが存在すればそのパスを、なければnullを返す
 * ダウンロードスクリプトは常に.jpg形式で保存する
 */
function findLocalOgImage(basePath: string): string | null {
  const filePath = join(publicDir, `${basePath}.jpg`);
  if (existsSync(filePath)) {
    return `${basePath}.jpg`;
  }
  return null;
}

/**
 * Podcast全体のOGP画像URLを取得
 * @param siteUrl - サイトのベースURL
 * @param fallbackUrl - ローカル画像がない場合のフォールバックURL（R2のURL）
 */
export function getPodcastOgImageUrl(siteUrl: string, fallbackUrl?: string): string | undefined {
  const localPath = findLocalOgImage("og/podcast");
  if (localPath && siteUrl) {
    return `${siteUrl.replace(/\/$/, "")}/${localPath}`;
  }
  return fallbackUrl;
}

/**
 * エピソードのOGP画像URLを取得
 * @param episodeId - エピソードID
 * @param siteUrl - サイトのベースURL
 * @param episodeOgUrl - エピソード固有のOGP画像URL
 * @param fallbackUrl - フォールバックURL（Podcastのartwork等）
 */
export function getEpisodeOgImageUrl(
  episodeId: string,
  siteUrl: string,
  episodeOgUrl?: string | null,
  fallbackUrl?: string
): string | undefined {
  // エピソード固有のローカル画像を探す
  const localPath = findLocalOgImage(`og/episodes/${episodeId}`);
  if (localPath && siteUrl) {
    return `${siteUrl.replace(/\/$/, "")}/${localPath}`;
  }

  // エピソード固有の画像がなければPodcastのOG画像にフォールバック
  const podcastLocalPath = findLocalOgImage("og/podcast");
  if (podcastLocalPath && siteUrl) {
    return `${siteUrl.replace(/\/$/, "")}/${podcastLocalPath}`;
  }

  // ローカルになければR2のURLを使用
  return episodeOgUrl || fallbackUrl;
}
