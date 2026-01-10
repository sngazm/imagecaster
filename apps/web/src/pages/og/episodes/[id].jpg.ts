import type { APIRoute, GetStaticPaths } from "astro";
import { getPublishedEpisodes } from "../../../lib/api";

const R2_PUBLIC_URL = import.meta.env.R2_PUBLIC_URL || "";

export const getStaticPaths: GetStaticPaths = async () => {
  const episodes = await getPublishedEpisodes();
  return episodes.map((episode) => ({
    params: { id: episode.id },
  }));
};

export const GET: APIRoute = async ({ params }) => {
  const { id } = params;

  if (!R2_PUBLIC_URL) {
    return new Response("R2_PUBLIC_URL not configured", { status: 500 });
  }

  // エピソード固有のOGP画像を試す
  let response = await fetch(`${R2_PUBLIC_URL}/episodes/${id}/og-image.jpg`);

  // なければPodcast OGP画像にフォールバック
  if (!response.ok) {
    response = await fetch(`${R2_PUBLIC_URL}/assets/og-image.jpg`);
  }

  // それもなければartworkにフォールバック
  if (!response.ok) {
    response = await fetch(`${R2_PUBLIC_URL}/assets/artwork.jpg`);
  }

  if (!response.ok) {
    return new Response("Image not found", { status: 404 });
  }

  const imageBuffer = await response.arrayBuffer();

  return new Response(imageBuffer, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
