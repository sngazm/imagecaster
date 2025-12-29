import type { Env, PodcastSecrets } from "../types";

/**
 * ポッドキャストのシークレットを取得
 */
export async function getSecrets(env: Env, podcastId: string): Promise<PodcastSecrets> {
  const key = `podcasts/${podcastId}/secrets`;
  const value = await env.SECRETS_KV.get(key);

  if (!value) {
    return {};
  }

  return JSON.parse(value) as PodcastSecrets;
}

/**
 * ポッドキャストのシークレットを保存
 */
export async function saveSecrets(env: Env, podcastId: string, secrets: PodcastSecrets): Promise<void> {
  const key = `podcasts/${podcastId}/secrets`;
  await env.SECRETS_KV.put(key, JSON.stringify(secrets));
}

/**
 * ポッドキャストのシークレットを削除
 */
export async function deleteSecrets(env: Env, podcastId: string): Promise<void> {
  const key = `podcasts/${podcastId}/secrets`;
  await env.SECRETS_KV.delete(key);
}

/**
 * シークレットを部分更新
 */
export async function updateSecrets(
  env: Env,
  podcastId: string,
  updates: Partial<PodcastSecrets>
): Promise<PodcastSecrets> {
  const current = await getSecrets(env, podcastId);
  const updated = { ...current, ...updates };
  await saveSecrets(env, podcastId, updated);
  return updated;
}
