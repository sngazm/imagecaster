import { useState, useEffect, useRef } from "react";
import { api, type Deployment } from "../lib/api";
import { getWebsiteUrl, getEnvironment } from "../lib/env";

const STAGE_CONFIG: Record<string, { label: string; color: string }> = {
  queued: { label: "待機中", color: "text-[var(--color-text-secondary)] bg-[var(--color-bg-elevated)]" },
  initialize: { label: "初期化中", color: "text-amber-400 bg-amber-500/10" },
  clone_repo: { label: "クローン中", color: "text-amber-400 bg-amber-500/10" },
  build: { label: "ビルド中", color: "text-blue-400 bg-blue-500/10" },
  deploy: { label: "反映済み", color: "text-[var(--color-success)] bg-[var(--color-success-muted)]" },
  failure: { label: "失敗", color: "text-[var(--color-error)] bg-[var(--color-error-muted)]" },
};

const DEFAULT_STAGE = { label: "不明", color: "text-[var(--color-text-secondary)] bg-[var(--color-bg-elevated)]" };

function getStageConfig(stageName: string) {
  return STAGE_CONFIG[stageName] || DEFAULT_STAGE;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return "たった今";
  if (diffMin < 60) return `${diffMin}分前`;
  if (diffHour < 24) return `${diffHour}時間前`;
  return `${diffDay}日前`;
}

interface BuildStatusProps {
  className?: string;
  label?: string;
}

export function BuildStatus({ className = "", label }: BuildStatusProps) {
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [configured, setConfigured] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [websiteUrl, setWebsiteUrl] = useState<string | undefined>();
  const [accountId, setAccountId] = useState<string | undefined>();
  const [projectName, setProjectName] = useState<string | undefined>();
  const [isTriggering, setIsTriggering] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const env = getEnvironment();

  const fetchDeployments = async () => {
    try {
      const [data, settings] = await Promise.all([
        api.getDeployments(),
        api.getSettings(),
      ]);
      setDeployments(data.deployments);
      setConfigured(data.configured);
      setAccountId(data.accountId);
      setProjectName(data.projectName);
      setWebsiteUrl(settings.websiteUrl);
    } catch (err) {
      console.error("Failed to fetch deployments:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // ビルド中かどうかを判定
  const isBuilding = deployments.length > 0 && deployments[0].latestStage.status === "active";

  const handleTriggerRebuild = async () => {
    if (isTriggering || isBuilding) return;
    setIsTriggering(true);
    try {
      await api.triggerDeploy();
      // 少し待ってからデプロイ状況を更新
      setTimeout(fetchDeployments, 1000);
    } catch (err) {
      console.error("Failed to trigger rebuild:", err);
    } finally {
      setIsTriggering(false);
    }
  };

  useEffect(() => {
    // ローカル開発環境ではdeployments取得をスキップ
    if (env === "local") {
      setIsLoading(false);
      return;
    }
    fetchDeployments();
  }, [env]);

  // ポーリング間隔を動的に変更
  useEffect(() => {
    // ローカル開発環境ではポーリングしない
    if (env === "local") {
      return;
    }

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    const interval = isBuilding ? 1000 : 10000;
    intervalRef.current = setInterval(fetchDeployments, interval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isBuilding, env]);

  // ローカル開発環境では何も表示しない
  if (env === "local") {
    return null;
  }

  if (isLoading) {
    return (
      <div className={`flex items-center gap-2 text-sm text-[var(--color-text-muted)] ${className}`}>
        <div className="w-4 h-4 border-2 border-[var(--color-border)] border-t-[var(--color-text-secondary)] rounded-full animate-spin" />
      </div>
    );
  }

  const latest = deployments.length > 0 ? deployments[0] : null;
  const stage = latest ? getStageConfig(latest.latestStage.name) : DEFAULT_STAGE;

  const dashboardUrl = accountId && projectName
    ? `https://dash.cloudflare.com/${accountId}/pages/view/${projectName}`
    : undefined;

  // 環境に応じたwebサイトURLを計算
  const displayWebsiteUrl = websiteUrl ? getWebsiteUrl(websiteUrl) : undefined;

  return (
    <div className={className}>
      {/* ヘッダー（ラベル + ステータスボタン） */}
      <div className="flex items-center justify-between">
        {label && (
          <span className="text-xs text-[var(--color-text-muted)]">
            {label}
          </span>
        )}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors whitespace-nowrap ${stage.color} hover:opacity-80`}
        >
          {isBuilding ? (
            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : (
            <span>{latest?.latestStage.status === "failure" ? "✗" : "✓"}</span>
          )}
          <span>{latest ? stage.label : "ビルド"}</span>
          <svg
            className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* 展開コンテンツ */}
      {isExpanded && (
        <div className="mt-3 space-y-3">
          {/* リンク */}
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {displayWebsiteUrl && (
              <a
                href={displayWebsiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[var(--color-accent)] hover:underline"
              >
                サイトを開く{env === "preview" ? " (プレビュー)" : ""} →
              </a>
            )}
            {dashboardUrl && (
              <a
                href={dashboardUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              >
                デプロイ管理 →
              </a>
            )}
          </div>

          {/* デプロイ履歴 */}
          <div className="space-y-1">
            {deployments.length === 0 ? (
              <p className="text-xs text-[var(--color-text-muted)]">
                {configured ? "履歴なし" : "環境変数の設定が必要"}
              </p>
            ) : (
              deployments.slice(0, 3).map((deployment) => {
                const depStage = getStageConfig(deployment.latestStage.name);
                const depIsBuilding = deployment.latestStage.status === "active";

                return (
                  <div
                    key={deployment.id}
                    className="flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-1.5">
                      {depIsBuilding ? (
                        <div className={`w-2.5 h-2.5 border-2 border-current border-t-transparent rounded-full animate-spin ${depStage.color.split(" ")[0]}`} />
                      ) : (
                        <span>{deployment.latestStage.status === "failure" ? "✗" : "✓"}</span>
                      )}
                      <span className={depStage.color.split(" ")[0]}>
                        {depStage.label}
                      </span>
                    </div>
                    <span className="text-[var(--color-text-muted)]">
                      {formatRelativeTime(deployment.createdOn)}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {/* アクションボタン */}
          <div className="flex gap-2">
            <button
              onClick={fetchDeployments}
              className="flex-1 text-center text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] py-1.5 border border-[var(--color-border)] rounded"
            >
              更新
            </button>
            <button
              onClick={handleTriggerRebuild}
              disabled={isTriggering || isBuilding}
              className="flex-1 text-center text-xs bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed py-1.5 px-2 rounded"
            >
              {isTriggering ? "実行中..." : "再ビルド"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
