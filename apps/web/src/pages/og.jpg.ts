import type { APIRoute } from "astro";
import { getPodcastIndex } from "../lib/api";
import { podcastOgCard } from "../lib/og";
import { renderOgImage } from "../lib/og-image";

/** 番組全体の OGP 画像（トップ・一覧・番組について） */
export const GET: APIRoute = async () => {
  const { podcast } = await getPodcastIndex();
  const image = await renderOgImage(podcastOgCard(podcast));

  return new Response(new Uint8Array(image), {
    headers: { "Content-Type": "image/jpeg" },
  });
};
