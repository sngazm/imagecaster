/**
 * 公開サイトのエピソードのページを見に行く
 *
 * 公開サイトは静的ビルドなので、公開から数分はページがまだ無い。告知（Discord・Bluesky）は
 * ページが出たのを確かめてから出す。そのための確認をここにまとめる。
 */

/**
 * エピソードの公開ページの URL（公開サイトの正規の形に合わせて末尾に / を付ける）
 */
export function episodePageUrl(websiteUrl: string, slug: string): string {
  return `${websiteUrl.replace(/\/+$/, "")}/episodes/${slug}/`;
}

/**
 * エピソードのページが公開サイトに出ていれば、その HTML を返す。まだ無ければ null
 *
 * 公開サイトは存在しないパスにもトップページを 200 で返すので、ステータスでは分からない。
 * 本文にそのエピソード自身の URL（og:url）が入っているかで見分ける。
 */
export async function fetchLiveEpisodePage(websiteUrl: string, slug: string): Promise<string | null> {
  try {
    const response = await fetch(episodePageUrl(websiteUrl, slug));
    if (!response.ok) return null;
    const html = await response.text();
    return html.includes(`/episodes/${slug}/"`) ? html : null;
  } catch (err) {
    console.error(`[EpisodePage] ページの確認に失敗: ${slug}`, err);
    return null;
  }
}

/**
 * ページの HTML から OGP 画像の URL を取り出す
 *
 * 画像の URL には中身ごとに変わる `?v=` が付くので、組み立てずにページに書いてあるものを読む。
 */
export function extractOgImageUrl(html: string): string | null {
  const tag = html.match(/<meta[^>]+property=["']og:image["'][^>]*>/i)?.[0];
  const url = tag?.match(/content=["']([^"']+)["']/i)?.[1];
  if (!url || !/^https?:\/\//.test(url)) return null;
  return url.replace(/&amp;/g, "&");
}
