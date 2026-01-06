import { getEnvironment, getPreviewInfo } from "../lib/env";

/**
 * Git ブランチアイコン
 */
function BranchIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
    </svg>
  );
}

/**
 * 環境を表示するバッジコンポーネント
 *
 * 本番環境では表示されず、プレビュー環境やローカル開発環境でのみ表示されます。
 * 画面右上に固定表示されます。
 */
export function EnvironmentBadge() {
  const env = getEnvironment();

  // 本番環境では表示しない
  if (env === "production") {
    return null;
  }

  if (env === "local") {
    return (
      <div className="fixed top-3 right-3 z-50 flex items-center gap-2 px-3 py-1.5 bg-[var(--color-accent)]/20 border border-[var(--color-accent)]/50 rounded-lg text-[var(--color-accent)] text-xs font-medium backdrop-blur-sm">
        <BranchIcon className="w-4 h-4 flex-shrink-0" />
        <span>dev</span>
      </div>
    );
  }

  // プレビュー環境
  const previewInfo = getPreviewInfo();
  const label = previewInfo?.identifier || "preview";

  // mainブランチは本番扱いなので表示しない
  if (label === "main" || label === "master") {
    return null;
  }

  return (
    <div
      className="fixed top-3 right-3 z-50 flex items-center gap-2 px-3 py-1.5 bg-amber-500/20 border border-amber-500/50 rounded-lg text-amber-300 text-xs font-medium backdrop-blur-sm max-w-[280px] group cursor-default"
      title={label}
    >
      <BranchIcon className="w-4 h-4 flex-shrink-0" />
      <span className="truncate">{label}</span>
    </div>
  );
}
