import { useEffect, useRef, useCallback, useState } from "react";
import { api } from "../lib/api";
import { runAllBackgroundTasks } from "../lib/backgroundTasks";

/**
 * バックグラウンドタスクを管理するフック
 *
 * アプリ起動時に1度だけエピソード一覧を取得し、バックグラウンドタスクを実行する。
 * タスク完了後にエピソード一覧が更新された場合、コールバックで通知する。
 */
export function useBackgroundTasks(onEpisodesUpdated?: () => void) {
  const initialized = useRef(false);
  const [isReady, setIsReady] = useState(false);

  const runTasks = useCallback(async () => {
    if (initialized.current) return;
    initialized.current = true;

    try {
      const data = await api.getEpisodes();
      await runAllBackgroundTasks(data.episodes, onEpisodesUpdated);
    } catch (err) {
      console.error("Background tasks initialization failed:", err);
    } finally {
      setIsReady(true);
    }
  }, [onEpisodesUpdated]);

  useEffect(() => {
    runTasks();
  }, [runTasks]);

  return { isReady };
}
