import { useState } from "react";
import { api } from "../lib/api";
import type { EpisodeDetail } from "../lib/api";

interface Props {
  episode: EpisodeDetail;
  onUpdated: () => void;
}

/**
 * Claude が書いたエピソードの感想
 *
 * 生成すると公開サイトのエピソードページに載る。気に入らなければ作り直せる。
 */
export function ClaudeImpressionPanel({ episode, onUpdated }: Props) {
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    if (episode.claudeImpression && !confirm("いまの感想を捨てて書き直します。よろしいですか?")) {
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      await api.generateImpression(episode.id);
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成に失敗しました");
    } finally {
      setGenerating(false);
    }
  }

  async function handleDelete() {
    if (!confirm("感想を削除します。公開サイトからも消えます。よろしいですか?")) {
      return;
    }

    setDeleting(true);
    setError(null);

    try {
      await api.deleteImpression(episode.id);
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除に失敗しました");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="card p-3 border-[var(--color-error)]! bg-[var(--color-error-muted)]">
          <p className="text-sm text-[var(--color-error)]">{error}</p>
        </div>
      )}

      {episode.claudeImpression ? (
        <>
          <p className="text-sm leading-relaxed text-[var(--color-text-secondary)] whitespace-pre-wrap">
            {episode.claudeImpression}
          </p>
          {episode.claudeImpressionAt && (
            <p className="text-xs text-[var(--color-text-muted)]">
              {new Date(episode.claudeImpressionAt).toLocaleString("ja-JP")}
              {" ・ "}
              {episode.claudeImpression.length} 文字
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-[var(--color-text-muted)]">
          文字起こしを読んだ Claude の感想を、エピソードページに載せられます。
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating || !episode.transcriptUrl}
          className="btn btn-secondary"
        >
          {generating
            ? "生成中..."
            : episode.claudeImpression
              ? "書き直す"
              : "感想を生成"}
        </button>

        {episode.claudeImpression && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="btn btn-ghost text-[var(--color-error)]"
          >
            {deleting ? "削除中..." : "削除"}
          </button>
        )}
      </div>

      {!episode.transcriptUrl && (
        <p className="text-xs text-[var(--color-text-muted)]">
          文字起こしができてから生成できます。
        </p>
      )}
    </div>
  );
}
