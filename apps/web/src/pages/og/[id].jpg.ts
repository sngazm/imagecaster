import type { APIRoute } from "astro";
import { getEpisodeBySlug, getPodcastIndex, getPublishedEpisodes } from "../../lib/api";
import { episodeOgCard } from "../../lib/og";
import { renderOgImage } from "../../lib/og-image";
import type { Episode } from "../../lib/types";

export async function getStaticPaths() {
  const episodes = await getPublishedEpisodes();
  return episodes.map((episode) => ({
    params: { id: episode.id },
    props: { episode },
  }));
}

/** エピソードの OGP 画像 */
export const GET: APIRoute = async ({ params, props }) => {
  // 開発時（SSR）は props が空なので、id から取る
  const episode: Episode = props.episode ?? (await getEpisodeBySlug(params.id!));
  const { podcast } = await getPodcastIndex();
  const image = await renderOgImage(episodeOgCard(episode, podcast));

  return new Response(new Uint8Array(image), {
    headers: { "Content-Type": "image/jpeg" },
  });
};
