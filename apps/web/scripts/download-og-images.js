#!/usr/bin/env node
/**
 * ビルド前にR2からOGP画像をダウンロードしてpublic/ogに配置する
 * これにより、Bluesky等のクローラーが正しく画像を取得できる
 */

import { mkdir, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");
const ogDir = join(publicDir, "og");
const episodesOgDir = join(ogDir, "episodes");

const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || "";

if (!R2_PUBLIC_URL) {
  console.warn("[OG Images] R2_PUBLIC_URL not set, skipping OG image download");
  process.exit(0);
}

/**
 * 画像をダウンロードして保存
 */
async function downloadImage(url, destPath) {
  try {
    console.log(`[OG Images] Downloading: ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[OG Images] Failed to fetch ${url}: ${response.status}`);
      return false;
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    // ディレクトリを作成
    const dir = dirname(destPath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    await writeFile(destPath, buffer);
    console.log(`[OG Images] Saved: ${destPath}`);
    return true;
  } catch (error) {
    console.warn(`[OG Images] Error downloading ${url}:`, error.message);
    return false;
  }
}

/**
 * URLから拡張子を取得
 */
function getExtension(url) {
  const match = url.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i);
  return match ? match[1].toLowerCase() : "jpg";
}

async function main() {
  console.log("[OG Images] Starting OG image download...");

  // ディレクトリ作成
  if (!existsSync(ogDir)) {
    await mkdir(ogDir, { recursive: true });
  }
  if (!existsSync(episodesOgDir)) {
    await mkdir(episodesOgDir, { recursive: true });
  }

  // index.jsonを取得
  let index;
  try {
    const response = await fetch(`${R2_PUBLIC_URL}/index.json`);
    if (!response.ok) {
      console.warn("[OG Images] index.json not found, skipping");
      process.exit(0);
    }
    index = await response.json();
  } catch (error) {
    console.warn("[OG Images] Failed to fetch index.json:", error.message);
    process.exit(0);
  }

  const podcast = index.podcast;

  // Podcast OGP画像をダウンロード
  const podcastOgUrl = podcast.ogImageUrl || podcast.artworkUrl;
  if (podcastOgUrl) {
    const ext = getExtension(podcastOgUrl);
    await downloadImage(podcastOgUrl, join(ogDir, `podcast.${ext}`));
  }

  // 各エピソードのOGP画像をダウンロード
  for (const epRef of index.episodes) {
    try {
      const metaResponse = await fetch(`${R2_PUBLIC_URL}/episodes/${epRef.id}/meta.json`);
      if (!metaResponse.ok) continue;

      const meta = await metaResponse.json();

      // 公開済みエピソードのみ
      if (meta.status !== "published") continue;

      // エピソード固有のOGP画像がある場合のみダウンロード
      if (meta.ogImageUrl) {
        const ext = getExtension(meta.ogImageUrl);
        await downloadImage(meta.ogImageUrl, join(episodesOgDir, `${meta.id}.${ext}`));
      }
    } catch (error) {
      console.warn(`[OG Images] Error processing episode ${epRef.id}:`, error.message);
    }
  }

  console.log("[OG Images] Done!");
}

main().catch((error) => {
  console.error("[OG Images] Fatal error:", error);
  process.exit(1);
});
