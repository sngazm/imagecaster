import { getEnvironment, getPreviewInfo } from "../lib/env";

/**
 * 環境を表示するバッジコンポーネント
 *
 * 本番環境では表示されず、プレビュー環境やローカル開発環境でのみ表示されます。
 */
export function EnvironmentBadge() {
  const env = getEnvironment();

  // 本番環境では表示しない
  if (env === "production") {
    return null;
  }

  if (env === "local") {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-violet-500/20 border border-violet-500/50 rounded-lg text-violet-300 text-xs font-medium">
        <span className="w-2 h-2 bg-violet-400 rounded-full animate-pulse" />
        ローカル開発
      </div>
    );
  }

  // プレビュー環境
  const previewInfo = getPreviewInfo();
  const label = previewInfo?.identifier || "プレビュー";

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/20 border border-amber-500/50 rounded-lg text-amber-300 text-xs font-medium">
      <span className="w-2 h-2 bg-amber-400 rounded-full" />
      <span className="truncate max-w-32" title={label}>
        {label}
      </span>
    </div>
  );
}
