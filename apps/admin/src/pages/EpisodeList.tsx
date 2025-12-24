import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api, Episode } from "../lib/api";

const STATUS_LABELS: Record<string, string> = {
  draft: "下書き",
  uploading: "アップロード中",
  processing: "処理中",
  transcribing: "文字起こし中",
  scheduled: "予約済み",
  published: "公開済み",
  failed: "エラー",
};

function formatDate(dateString: string | null): string {
  if (!dateString) return "-";
  const date = new Date(dateString);
  return date.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function EpisodeList() {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEpisodes = async () => {
    try {
      setError(null);
      setIsLoading(true);
      const data = await api.getEpisodes();
      setEpisodes(data.episodes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "一覧の取得に失敗しました");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchEpisodes();
  }, []);

  return (
    <div className="container">
      <header className="page-header">
        <h1>エピソード一覧</h1>
        <Link to="/new" className="button primary">
          新規登録
        </Link>
      </header>

      <section className="section">
        {isLoading && <div className="loading">読み込み中...</div>}

        {error && <div className="error">{error}</div>}

        {!isLoading && !error && episodes.length === 0 && (
          <div className="empty">
            <p>エピソードがありません</p>
            <Link to="/new" className="button primary">
              最初のエピソードを登録
            </Link>
          </div>
        )}

        {!isLoading && !error && episodes.length > 0 && (
          <table className="episode-table">
            <thead>
              <tr>
                <th>#</th>
                <th>タイトル</th>
                <th>ステータス</th>
                <th>公開日時</th>
              </tr>
            </thead>
            <tbody>
              {episodes.map((ep) => (
                <tr key={ep.id}>
                  <td>{ep.episodeNumber}</td>
                  <td>{ep.title}</td>
                  <td>
                    <span className={`status status-${ep.status}`}>
                      {STATUS_LABELS[ep.status] || ep.status}
                    </span>
                  </td>
                  <td>{formatDate(ep.publishedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!isLoading && (
          <button
            className="button secondary"
            onClick={fetchEpisodes}
            disabled={isLoading}
          >
            更新
          </button>
        )}
      </section>
    </div>
  );
}
