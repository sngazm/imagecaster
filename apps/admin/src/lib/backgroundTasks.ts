/**
 * バックグラウンドタスク実行ロジック
 *
 * 管理画面で自動実行されるバックグラウンドタスクの定義。
 * 新しいタスクを追加する場合はここに追加する。
 */

import { api, Episode, PodcastSettings } from "./api";
import { searchApplePodcastsEpisodeByTitle } from "./itunes";
import { taskStore } from "./taskStore";

// タスク実行済みフラグ（セッション内で1回だけ実行）
const taskRanFlags: Record<string, boolean> = {};

/**
 * Apple Podcasts URL 自動取得タスク
 */
export async function runApplePodcastsAutoFetch(
  episodes: Episode[],
  settings: PodcastSettings,
  onComplete?: () => void
): Promise<void> {
  const taskType = "apple-podcasts";
  const taskId = `${taskType}-${Date.now()}`;

  // 既に実行済み or 実行中ならスキップ
  if (taskRanFlags[taskType] || taskStore.isRunning(taskType)) {
    return;
  }

  // 自動取得が無効または ID が未設定
  if (!settings.applePodcastsAutoFetch || !settings.applePodcastsId) {
    return;
  }

  // 公開から1日以上経過 & applePodcastsUrl が未設定のエピソードを抽出
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const targetEpisodes = episodes.filter((ep) => {
    if (ep.status !== "published" || ep.applePodcastsUrl) return false;
    const publishedAt = ep.publishedAt ? new Date(ep.publishedAt).getTime() : 0;
    return publishedAt > 0 && publishedAt < oneDayAgo;
  });

  if (targetEpisodes.length === 0) {
    return;
  }

  // フラグを立てる
  taskRanFlags[taskType] = true;

  // タスク開始
  taskStore.start(taskId, taskType, "Apple Podcasts URL を取得中");

  try {
    let foundCount = 0;
    let processedCount = 0;

    // 各エピソードをタイトル検索で取得（5秒間隔でレート制限対応）
    for (const ep of targetEpisodes) {
      // 進捗とエピソードタイトルを表示
      taskStore.updateProgress(
        taskId,
        `${processedCount}/${targetEpisodes.length}件`,
        ep.title
      );

      const guid = ep.sourceGuid || ep.slug || ep.id;
      const applePodcastsUrl = await searchApplePodcastsEpisodeByTitle(
        ep.title,
        guid,
        settings.applePodcastsId
      );

      if (applePodcastsUrl) {
        await api.updateEpisode(ep.id, { applePodcastsUrl });
        foundCount++;
      }

      processedCount++;
      taskStore.updateProgress(taskId, `${processedCount}/${targetEpisodes.length}件`);
    }

    if (foundCount > 0) {
      // URLが設定されたらデプロイをトリガー
      try {
        await api.triggerDeploy();
        taskStore.complete(taskId, `${foundCount}件のURLを設定しました（デプロイ開始）`);
      } catch {
        taskStore.complete(taskId, `${foundCount}件のURLを設定しました（デプロイ失敗）`);
      }
      onComplete?.();
    } else {
      taskStore.complete(taskId, "該当するエピソードが見つかりませんでした");
    }
  } catch (err) {
    console.error("Apple Podcasts auto-fetch failed:", err);
    taskStore.fail(taskId, err instanceof Error ? err.message : "取得に失敗しました");
  }
}

/**
 * Spotify URL 自動取得タスク
 */
export async function runSpotifyAutoFetch(
  episodes: Episode[],
  settings: PodcastSettings,
  onComplete?: () => void
): Promise<void> {
  const taskType = "spotify";
  const taskId = `${taskType}-${Date.now()}`;

  // 既に実行済み or 実行中ならスキップ
  if (taskRanFlags[taskType] || taskStore.isRunning(taskType)) {
    return;
  }

  // 自動取得が無効または Show ID が未設定
  if (!settings.spotifyAutoFetch || !settings.spotifyShowId) {
    return;
  }

  // 公開から1日以上経過 & spotifyUrl が未設定のエピソードがあるか確認
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const targetEpisodes = episodes.filter((ep) => {
    if (ep.status !== "published" || ep.spotifyUrl) return false;
    const publishedAt = ep.publishedAt ? new Date(ep.publishedAt).getTime() : 0;
    return publishedAt > 0 && publishedAt < oneDayAgo;
  });

  if (targetEpisodes.length === 0) {
    return;
  }

  // フラグを立てる
  taskRanFlags[taskType] = true;

  // タスク開始
  taskStore.start(taskId, taskType, "Spotify URL を取得中");

  try {
    taskStore.updateProgress(taskId, "Spotify API に接続中...");

    // Worker API経由で一括取得
    const result = await api.fetchSpotifyEpisodes();

    if (result.matched > 0) {
      // URLが設定されたらデプロイをトリガー
      try {
        await api.triggerDeploy();
        taskStore.complete(
          taskId,
          `${result.matched}件のURLを設定しました（デプロイ開始）`
        );
      } catch {
        taskStore.complete(
          taskId,
          `${result.matched}件のURLを設定しました（デプロイ失敗）`
        );
      }
      onComplete?.();
    } else {
      taskStore.complete(taskId, "該当するエピソードが見つかりませんでした");
    }
  } catch (err) {
    console.error("Spotify auto-fetch failed:", err);
    taskStore.fail(taskId, err instanceof Error ? err.message : "取得に失敗しました");
  }
}

/**
 * すべてのバックグラウンドタスクを実行
 *
 * 管理画面の読み込み時に呼び出す
 */
export async function runAllBackgroundTasks(
  episodes: Episode[],
  onEpisodesUpdated?: () => void
): Promise<void> {
  try {
    const settings = await api.getSettings();

    // Apple Podcasts URL 自動取得
    await runApplePodcastsAutoFetch(episodes, settings, onEpisodesUpdated);

    // Spotify URL 自動取得
    await runSpotifyAutoFetch(episodes, settings, onEpisodesUpdated);

    // 将来追加するタスク:
    // - 文字起こしステータス確認
    // など
  } catch (err) {
    console.error("Background tasks failed:", err);
  }
}

/**
 * タスク実行フラグをリセット（テスト用）
 */
export function resetTaskFlags(): void {
  Object.keys(taskRanFlags).forEach((key) => {
    delete taskRanFlags[key];
  });
}
