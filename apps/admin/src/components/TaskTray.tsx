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
        <svg className="w-4 h-4 text-purple-400" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 3.6c4.636 0 8.4 3.764 8.4 8.4 0 2.812-1.38 5.298-3.502 6.822-.164-.58-.41-1.35-.706-2.175.805-.858 1.308-2.143 1.308-3.447 0-3.037-2.463-5.5-5.5-5.5S6.5 10.163 6.5 13.2c0 1.304.503 2.589 1.308 3.447-.296.825-.542 1.595-.706 2.175C4.98 17.298 3.6 14.812 3.6 12c0-4.636 3.764-8.4 8.4-8.4zm0 4.8c1.988 0 3.6 1.612 3.6 3.6 0 .752-.28 1.433-.7 1.988-.178-.495-.377-.997-.583-1.478a1.8 1.8 0 10-2.634 0c-.206.481-.405.983-.583 1.478-.42-.555-.7-1.236-.7-1.988 0-1.988 1.612-3.6 3.6-3.6zm0 6c.259 0 .458.147.573.382.567 1.153 1.227 2.897 1.227 3.618 0 .994-.806 1.8-1.8 1.8s-1.8-.806-1.8-1.8c0-.721.66-2.465 1.227-3.618.115-.235.314-.382.573-.382z"/>
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
