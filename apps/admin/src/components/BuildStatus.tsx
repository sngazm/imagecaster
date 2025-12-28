import { useState, useEffect } from "react";
import { api, type Deployment } from "../lib/api";

const STAGE_CONFIG: Record<
  string,
  { label: string; color: string; icon: string }
> = {
  queued: {
    label: "待機中",
    color: "text-zinc-400 bg-zinc-800",
    icon: "⏳",
  },
  initializing: {
    label: "初期化中",
    color: "text-amber-400 bg-amber-500/10",
    icon: "🔄",
  },
  initialize: {
    label: "初期化中",
    color: "text-amber-400 bg-amber-500/10",
    icon: "🔄",
  },
  cloning: {
    label: "クローン中",
    color: "text-amber-400 bg-amber-500/10",
    icon: "📥",
  },
  building: {
    label: "ビルド中",
    color: "text-blue-400 bg-blue-500/10",
    icon: "🔨",
  },
  build: {
    label: "ビルド中",
    color: "text-blue-400 bg-blue-500/10",
    icon: "🔨",
  },
  deploying: {
    label: "デプロイ中",
    color: "text-violet-400 bg-violet-500/10",
    icon: "🚀",
  },
  deploy: {
    label: "完了",
    color: "text-emerald-400 bg-emerald-500/10",
    icon: "✓",
  },
  success: {
    label: "完了",
    color: "text-emerald-400 bg-emerald-500/10",
    icon: "✓",
  },
  failure: {
    label: "失敗",
    color: "text-red-400 bg-red-500/10",
    icon: "✗",
  },
};

const DEFAULT_STAGE = {
  label: "不明",
  color: "text-zinc-400 bg-zinc-800",
  icon: "?",
};

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
}

export function BuildStatus({ className = "" }: BuildStatusProps) {
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [configured, setConfigured] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);

  const fetchDeployments = async () => {
    try {
      const data = await api.getDeployments();
      setDeployments(data.deployments);
      setConfigured(data.configured);
    } catch (err) {
      console.error("Failed to fetch deployments:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDeployments();

    // 10秒ごとにポーリング（ビルド中かどうかに関わらず）
    const interval = setInterval(fetchDeployments, 10000);

    return () => clearInterval(interval);
  }, []);

  // 設定されていない場合は何も表示しない
  if (!configured && !isLoading) {
    return null;
  }

  if (isLoading) {
    return (
      <div className={`flex items-center gap-2 text-sm text-zinc-500 ${className}`}>
        <div className="w-4 h-4 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
      </div>
    );
  }

  if (deployments.length === 0) {
    return null;
  }

  const latest = deployments[0];
  const stage = getStageConfig(latest.latestStage.name);
  const isBuilding = latest.latestStage.status === "active";

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${stage.color} hover:opacity-80`}
      >
        {isBuilding ? (
          <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
        ) : (
          <span>{stage.icon}</span>
        )}
        <span>Web {stage.label}</span>
      </button>

      {isExpanded && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsExpanded(false)}
          />
          <div className="absolute right-0 top-full mt-2 w-80 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl z-50">
            <div className="p-3 border-b border-zinc-700">
              <h3 className="font-medium text-zinc-100">Web サイトのビルド状況</h3>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {deployments.map((deployment) => {
                const depStage = getStageConfig(deployment.latestStage.name);
                const depIsBuilding = deployment.latestStage.status === "active";

                return (
                  <div
                    key={deployment.id}
                    className="p-3 border-b border-zinc-800 last:border-b-0 hover:bg-zinc-800/50"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {depIsBuilding ? (
                          <div className={`w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin ${depStage.color.split(" ")[0]}`} />
                        ) : (
                          <span className="text-sm">{depStage.icon}</span>
                        )}
                        <span className={`text-sm font-medium ${depStage.color.split(" ")[0]}`}>
                          {depStage.label}
                        </span>
                      </div>
                      <span className="text-xs text-zinc-500">
                        {formatRelativeTime(deployment.createdOn)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="p-2 border-t border-zinc-700">
              <button
                onClick={() => {
                  fetchDeployments();
                }}
                className="w-full text-center text-xs text-zinc-400 hover:text-zinc-200 py-1"
              >
                更新
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
