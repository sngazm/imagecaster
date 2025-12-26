import type { APIRoute } from "astro";
import { getFeed } from "../lib/api";

export const GET: APIRoute = async () => {
  const feed = await getFeed();

  return new Response(feed, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
    },
  });
};
