import { useState } from "react";
import { useTasks, taskStore, type Task } from "../lib/taskStore";

/**
 * タスクタイプに応じたアイコン
 */
function TaskIcon({ type, status }: { type: string; status: string }) {
  // 成功時は常にチェックマーク
  if (status === "success") {
    return (
      <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    );
  }

  // エラー時は×マーク
  if (status === "error") {
    return (
      <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    );
  }

  // 実行中はタイプに応じたアイコン
  switch (type) {
    case "apple-podcasts":
      return (
        <svg className="w-4 h-4 text-pink-400" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12.001 2C6.477 2 2 6.477 2 12c0 4.544 3.047 8.368 7.197 9.58-.07-.51-.13-1.29.025-1.845.14-.495.9-3.17.9-3.17s-.23-.46-.23-1.14c0-1.066.62-1.863 1.39-1.863.656 0 .972.493.972 1.084 0 .66-.42 1.647-.637 2.562-.18.764.383 1.388 1.136 1.388 1.364 0 2.413-1.438 2.413-3.516 0-1.838-1.32-3.123-3.206-3.123-2.182 0-3.464 1.637-3.464 3.33 0 .66.254 1.367.572 1.75.063.077.072.144.053.222-.058.243-.188.764-.214.87-.034.141-.11.17-.256.103-.956-.445-1.553-1.842-1.553-2.965 0-2.413 1.753-4.63 5.055-4.63 2.654 0 4.717 1.89 4.717 4.416 0 2.636-1.662 4.76-3.968 4.76-.775 0-1.503-.403-1.752-.878l-.477 1.818c-.173.664-.639 1.496-.951 2.004A9.97 9.97 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2z"/>
        </svg>
      );
    case "spotify":
      return (
        <svg className="w-4 h-4 text-green-400" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
        </svg>
      );
    case "transcription":
      return (
        <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
    default:
      return (
        <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      );
  }
}

/**
 * 個々のタスク表示
 */
function TaskItem({ task }: { task: Task }) {
  const statusColors = {
    running: "border-l-violet-500",
    success: "border-l-emerald-500",
    error: "border-l-red-500",
  };

  return (
    <div
      className={`flex items-start gap-3 p-3 bg-zinc-900 border-l-2 ${statusColors[task.status]} rounded-r transition-all`}
    >
      <div className="flex-shrink-0 mt-0.5">
        {task.status === "running" ? (
          <div className="relative">
            <TaskIcon type={task.type} status={task.status} />
            <div className="absolute -top-1 -right-1 w-2 h-2 bg-violet-500 rounded-full animate-pulse" />
          </div>
        ) : (
          <TaskIcon type={task.type} status={task.status} />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-zinc-200 truncate">
            {task.label}
          </span>
          {task.progress && task.status === "running" && (
            <span className="text-xs text-zinc-500">{task.progress}</span>
          )}
        </div>
        {task.message && (
          <p className={`text-xs mt-0.5 ${task.status === "error" ? "text-red-400" : "text-zinc-500"}`}>
            {task.message}
          </p>
        )}
      </div>

      <button
        onClick={() => taskStore.remove(task.id)}
        className="flex-shrink-0 p-1 text-zinc-600 hover:text-zinc-400 transition-colors"
        title="閉じる"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

/**
 * タスクトレイ - 右下に固定表示
 */
export function TaskTray() {
  const tasks = useTasks();
  const [isCollapsed, setIsCollapsed] = useState(false);

  // タスクがなければ何も表示しない
  if (tasks.length === 0) {
    return null;
  }

  const runningCount = tasks.filter((t) => t.status === "running").length;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80">
      {/* ヘッダー（折りたたみ可能） */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-t-lg hover:bg-zinc-750 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
          </svg>
          <span className="text-sm font-medium text-zinc-300">バックグラウンドタスク</span>
          {runningCount > 0 && (
            <span className="px-1.5 py-0.5 bg-violet-500/20 text-violet-400 text-xs rounded">
              {runningCount}件実行中
            </span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-zinc-500 transition-transform ${isCollapsed ? "" : "rotate-180"}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      </button>

      {/* タスクリスト */}
      {!isCollapsed && (
        <div className="bg-zinc-850 border border-t-0 border-zinc-700 rounded-b-lg overflow-hidden">
          <div className="max-h-64 overflow-y-auto divide-y divide-zinc-800">
            {tasks.map((task) => (
              <TaskItem key={task.id} task={task} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
