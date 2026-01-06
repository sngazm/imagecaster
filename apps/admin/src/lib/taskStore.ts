/**
 * バックグラウンドタスク管理ストア
 *
 * 管理画面で実行されるバックグラウンドタスクを一元管理する。
 * - Apple Podcasts URL 自動取得
 * - Spotify URL 自動取得（将来）
 * - 文字起こし状態の監視（将来）
 * など
 */

import { useState, useEffect } from "react";

export type TaskStatus = "running" | "success" | "error";

export interface Task {
  id: string;
  type: string;
  label: string;
  status: TaskStatus;
  progress?: string; // 例: "3/10件"
  detail?: string; // 現在処理中のアイテム名など
  message?: string; // 完了時やエラー時のメッセージ
  startedAt: number;
  completedAt?: number;
}

type Listener = () => void;

class TaskStore {
  private tasks: Map<string, Task> = new Map();
  private listeners: Set<Listener> = new Set();
  private snapshot: Task[] = []; // キャッシュされたスナップショット

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    // スナップショットを更新（新しい参照を作成）
    this.snapshot = Array.from(this.tasks.values());
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
  updateProgress(id: string, progress: string, detail?: string): void {
    const task = this.tasks.get(id);
    if (task) {
      task.progress = progress;
      task.detail = detail;
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
   * 全タスクを取得する（キャッシュされたスナップショットを返す）
   */
  getSnapshot(): Task[] {
    return this.snapshot;
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
export function useTasks(): Task[] {
  const [tasks, setTasks] = useState<Task[]>(() => taskStore.getSnapshot());

  useEffect(() => {
    // 初期値を設定
    setTasks(taskStore.getSnapshot());

    // ストアの変更を購読
    const unsubscribe = taskStore.subscribe(() => {
      setTasks(taskStore.getSnapshot());
    });

    return unsubscribe;
  }, []);

  return tasks;
}
