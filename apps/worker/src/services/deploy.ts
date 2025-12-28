import type { Env } from "../types";

/**
 * Deploy Hook を呼び出して Web サイトをリビルド
 */
export async function triggerWebRebuild(env: Env): Promise<void> {
  // ローカル開発時はスキップ
  if (env.IS_DEV === "true") {
    console.log("Skipping web rebuild trigger (dev mode)");
    return;
  }

  if (!env.WEB_DEPLOY_HOOK_URL) {
    console.log("WEB_DEPLOY_HOOK_URL not configured, skipping rebuild trigger");
    return;
  }

  try {
    const response = await fetch(env.WEB_DEPLOY_HOOK_URL, {
      method: "POST",
    });

    if (response.ok) {
      console.log("Web rebuild triggered successfully");
    } else {
      console.error(`Failed to trigger web rebuild: ${response.status}`);
    }
  } catch (err) {
    console.error("Error triggering web rebuild:", err);
  }
}
