import type { APIRoute } from "astro";

const R2_PUBLIC_URL = import.meta.env.R2_PUBLIC_URL || "";

export const GET: APIRoute = async () => {
  if (!R2_PUBLIC_URL) {
    return new Response("R2_PUBLIC_URL not configured", { status: 500 });
  }

  // まずOGP画像を試す
  let response = await fetch(`${R2_PUBLIC_URL}/assets/og-image.jpg`);

  // OGP画像がなければartworkを試す
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
