/**
 * バックグラウンドタスク管理ストア
 *
 * 管理画面で実行されるバックグラウンドタスクを一元管理する。
 * - Apple Podcasts URL 自動取得
 * - Spotify URL 自動取得（将来）
 * - 文字起こし状態の監視（将来）
 * など
 */

export type TaskStatus = "running" | "success" | "error";

export interface Task {
  id: string;
  type: string;
  label: string;
  status: TaskStatus;
  progress?: string; // 例: "3/10件"
  message?: string; // 完了時やエラー時のメッセージ
  startedAt: number;
  completedAt?: number;
}

type Listener = () => void;

class TaskStore {
  private tasks: Map<string, Task> = new Map();
  private listeners: Set<Listener> = new Set();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }

  /**
   * タスクを開始する
   */
  start(id: string, type: string, label: string): void {
    this.tasks.set(id, {
      id,
      type,
      label,
      status: "running",
      startedAt: Date.now(),
    });
    this.notify();
  }

  /**
   * タスクの進捗を更新する
   */
  updateProgress(id: string, progress: string): void {
    const task = this.tasks.get(id);
    if (task) {
      task.progress = progress;
      this.notify();
    }
  }

  /**
   * タスクを成功で完了する
   */
  complete(id: string, message?: string): void {
    const task = this.tasks.get(id);
    if (task) {
      task.status = "success";
      task.message = message;
      task.completedAt = Date.now();
      this.notify();

      // 3秒後に自動削除
      setTimeout(() => this.remove(id), 3000);
    }
  }

  /**
   * タスクをエラーで終了する
   */
  fail(id: string, message: string): void {
    const task = this.tasks.get(id);
    if (task) {
      task.status = "error";
      task.message = message;
      task.completedAt = Date.now();
      this.notify();

      // 5秒後に自動削除
      setTimeout(() => this.remove(id), 5000);
    }
  }

  /**
   * タスクを削除する
   */
  remove(id: string): void {
    if (this.tasks.delete(id)) {
      this.notify();
    }
  }

  /**
   * 全タスクを取得する
   */
  getAll(): Task[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 特定タイプのタスクが実行中かどうか
   */
  isRunning(type: string): boolean {
    return Array.from(this.tasks.values()).some(
      (t) => t.type === type && t.status === "running"
    );
  }
}

// シングルトンインスタンス
export const taskStore = new TaskStore();

// React用フック
import { useSyncExternalStore } from "react";

export function useTasks(): Task[] {
  return useSyncExternalStore(
    (listener) => taskStore.subscribe(listener),
    () => taskStore.getAll()
  );
}
