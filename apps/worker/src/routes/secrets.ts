import { Hono } from "hono";
import type { Env, UpdateSecretsRequest, PodcastSecrets } from "../types";
import { getSecrets, updateSecrets } from "../services/kv";

export const secrets = new Hono<{ Bindings: Env }>();

/**
 * GET /api/podcasts/:podcastId/secrets - シークレット設定を取得
 * パスワードは返さない（設定済みかどうかのみ）
 */
secrets.get("/", async (c) => {
  const podcastId = c.req.param("podcastId");
  const secretsData = await getSecrets(c.env, podcastId);

  // パスワードはマスク
  return c.json({
    blueskyIdentifier: secretsData.blueskyIdentifier || null,
    blueskyPasswordSet: !!secretsData.blueskyPassword,
    deployHookUrlSet: !!secretsData.deployHookUrl,
  });
});

/**
 * PUT /api/podcasts/:podcastId/secrets - シークレット設定を更新
 */
secrets.put("/", async (c) => {
  const podcastId = c.req.param("podcastId");
  const body = await c.req.json<UpdateSecretsRequest>();

  const updates: Partial<PodcastSecrets> = {};

  if (body.blueskyIdentifier !== undefined) {
    updates.blueskyIdentifier = body.blueskyIdentifier;
  }
  if (body.blueskyPassword !== undefined) {
    updates.blueskyPassword = body.blueskyPassword;
  }
  if (body.deployHookUrl !== undefined) {
    updates.deployHookUrl = body.deployHookUrl;
  }

  await updateSecrets(c.env, podcastId, updates);

  // パスワードはマスクして返す
  const secretsData = await getSecrets(c.env, podcastId);
  return c.json({
    blueskyIdentifier: secretsData.blueskyIdentifier || null,
    blueskyPasswordSet: !!secretsData.blueskyPassword,
    deployHookUrlSet: !!secretsData.deployHookUrl,
  });
});
