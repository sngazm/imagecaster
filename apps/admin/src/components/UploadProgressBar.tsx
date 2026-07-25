import { formatFileSize } from "../lib/api";
import type { UploadProgress } from "../lib/api";

interface UploadProgressBarProps {
  progress: UploadProgress;
}

/**
 * 音声アップロードなどの進捗ゲージ。
 * 転送済みバイト数 / 合計バイト数とパーセントを表示する。
 */
export function UploadProgressBar({ progress }: UploadProgressBarProps) {
  return (
    <div>
      <div
        className="w-full h-2 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={progress.percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full bg-[var(--color-accent)] rounded-full transition-all duration-200"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-xs text-[var(--color-text-muted)]">
        <span>
          {formatFileSize(progress.loaded)} / {formatFileSize(progress.total)}
        </span>
        <span>{progress.percent}%</span>
      </div>
    </div>
  );
}
