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
          <path d="M5.34 0A5.328 5.328 0 000 5.34v13.32A5.328 5.328 0 005.34 24h13.32A5.328 5.328 0 0024 18.66V5.34A5.328 5.328 0 0018.66 0zm6.525 2.568c2.336 0 4.448.902 6.056 2.587 1.224 1.272 1.912 2.619 2.264 4.392.12.59.12 2.2.007 2.864a8.506 8.506 0 01-3.24 5.296c-.608.46-2.096 1.261-2.336 1.261-.088 0-.096-.091-.056-.46.072-.592.144-.715.48-.856.536-.224 1.448-.874 2.008-1.435a7.644 7.644 0 002.008-3.536c.208-.824.184-2.656-.048-3.504-.728-2.696-2.928-4.792-5.624-5.352-.784-.16-2.208-.16-3 0-2.728.56-4.984 2.76-5.672 5.528-.184.752-.184 2.584 0 3.336.456 1.832 1.64 3.512 3.192 4.512.304.2.672.408.824.472.336.144.408.264.472.856.04.36.03.464-.056.464-.056 0-.464-.176-.896-.384l-.04-.03c-2.472-1.216-4.056-3.274-4.632-6.012-.144-.706-.168-2.392-.03-3.04.36-1.74 1.048-3.1 2.192-4.304 1.648-1.737 3.768-2.656 6.128-2.656zm.134 2.81c.409.004.803.04 1.106.106 2.784.62 4.76 3.408 4.376 6.174-.152 1.114-.536 2.03-1.216 2.88-.336.43-1.152 1.15-1.296 1.15-.023 0-.048-.272-.048-.603v-.605l.416-.496c1.568-1.878 1.456-4.502-.256-6.224-.664-.67-1.432-1.064-2.424-1.246-.64-.118-.776-.118-1.448-.008-1.02.167-1.81.562-2.512 1.256-1.72 1.704-1.832 4.342-.264 6.222l.413.496v.608c0 .336-.027.608-.06.608-.03 0-.264-.16-.512-.36l-.034-.011c-.832-.664-1.568-1.842-1.872-2.997-.184-.698-.184-2.024.008-2.72.504-1.878 1.888-3.335 3.808-4.019.41-.145 1.133-.22 1.814-.211zm-.13 2.99c.31 0 .62.06.844.178.488.253.888.745 1.04 1.259.464 1.578-1.208 2.96-2.72 2.254h-.015c-.712-.331-1.096-.956-1.104-1.77 0-.733.408-1.371 1.112-1.745.224-.117.534-.176.844-.176zm-.011 4.728c.988-.004 1.706.349 1.97.97.198.464.124 1.932-.218 4.302-.232 1.656-.36 2.074-.68 2.356-.44.39-1.064.498-1.656.288h-.003c-.716-.257-.87-.605-1.164-2.644-.341-2.37-.416-3.838-.218-4.302.262-.616.974-.966 1.97-.97z"/>
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
        <svg className="w-4 h-4 text-[var(--color-text-secondary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
    running: "border-l-[var(--color-accent)]",
    success: "border-l-[var(--color-success)]",
    error: "border-l-[var(--color-error)]",
  };

  return (
    <div
      className={`flex items-start gap-3 p-3 bg-[var(--color-bg-elevated)] border-l-2 ${statusColors[task.status]} rounded-r transition-all`}
    >
      <div className="flex-shrink-0 mt-0.5">
        {task.status === "running" ? (
          <div className="relative">
            <TaskIcon type={task.type} status={task.status} />
            <div className="absolute -top-1 -right-1 w-2 h-2 bg-[var(--color-accent)] rounded-full animate-pulse" />
          </div>
        ) : (
          <TaskIcon type={task.type} status={task.status} />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
            {task.label}
          </span>
          {task.progress && task.status === "running" && (
            <span className="text-xs text-[var(--color-text-muted)]">{task.progress}</span>
          )}
        </div>
        {task.detail && task.status === "running" && (
          <p className="text-xs mt-0.5 text-[var(--color-text-muted)] truncate">
            {task.detail}
          </p>
        )}
        {task.message && (
          <p className={`text-xs mt-0.5 ${task.status === "error" ? "text-[var(--color-error)]" : "text-[var(--color-text-muted)]"}`}>
            {task.message}
          </p>
        )}
      </div>

      <button
        onClick={() => taskStore.remove(task.id)}
        className="flex-shrink-0 p-1 text-[var(--color-text-faint)] hover:text-[var(--color-text-secondary)] transition-colors"
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
        className="w-full flex items-center justify-between px-4 py-2.5 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-t-lg hover:bg-[var(--color-bg-hover)] transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-[var(--color-text-secondary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
          </svg>
          <span className="text-sm font-medium text-[var(--color-text-secondary)]">バックグラウンドタスク</span>
          {runningCount > 0 && (
            <span className="px-1.5 py-0.5 bg-[var(--color-accent)]/20 text-[var(--color-accent)] text-xs rounded">
              {runningCount}件実行中
            </span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-[var(--color-text-muted)] transition-transform ${isCollapsed ? "" : "rotate-180"}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      </button>

      {/* タスクリスト */}
      {!isCollapsed && (
        <div className="bg-[var(--color-bg-base)] border border-t-0 border-[var(--color-border)] rounded-b-lg overflow-hidden">
          <div className="max-h-64 overflow-y-auto divide-y divide-[var(--color-border)]">
            {tasks.map((task) => (
              <TaskItem key={task.id} task={task} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
