import type { Env } from "../types";
import { getSecrets } from "./kv";

/**
 * Deploy Hook を呼び出して Web サイトをリビルド
 */
export async function triggerWebRebuild(env: Env, podcastId: string): Promise<void> {
  // ローカル開発時はスキップ
  if (env.IS_DEV === "true") {
    console.log("Skipping web rebuild trigger (dev mode)");
    return;
  }

  // KVからDeploy Hook URLを取得
  const secrets = await getSecrets(env, podcastId);

  if (!secrets.deployHookUrl) {
    console.log(`Deploy hook URL not configured for podcast: ${podcastId}`);
    return;
  }

  try {
    const response = await fetch(secrets.deployHookUrl, {
      method: "POST",
    });

    if (response.ok) {
      console.log(`Web rebuild triggered successfully for podcast: ${podcastId}`);
    } else {
      console.error(`Failed to trigger web rebuild for podcast ${podcastId}: ${response.status}`);
    }
  } catch (err) {
    console.error(`Error triggering web rebuild for podcast ${podcastId}:`, err);
  }
}
