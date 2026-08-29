import { useState } from "react";
import { api, uploadToR2 } from "../lib/api";
import type {
  EpisodeDetail,
  SpeakerTrackAssignment,
  UploadProgress,
} from "../lib/api";
import { UploadProgressBar } from "./UploadProgressBar";

interface Props {
  episode: EpisodeDetail;
  /** 番組全体の既定の割り当て（エピソード固有の指定が無いときに使われる） */
  defaults: SpeakerTrackAssignment[];
  onUpdated: () => void;
}

/**
 * 話者トラック（zip）のアップロードと、トラックへの話者の割り当て
 *
 * 話者ごとに分かれた音声があれば、区間ごとの音量を比べて誰が喋っているかを判定できる。
 * 番組の既定値で足りることが多いが、ゲスト回はトラック構成が変わるのでここで上書きする。
 */
export function SpeakerTracksPanel({ episode, defaults, onUpdated }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reprocessing, setReprocessing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // エピソード固有の指定が無ければ番組の既定値を編集の出発点にする
  const [tracks, setTracks] = useState<SpeakerTrackAssignment[]>(
    episode.speakerTracks && episode.speakerTracks.length > 0
      ? episode.speakerTracks
      : defaults
  );

  const hasTracks = Boolean(episode.tracksUploadedAt);
  const usingDefaults =
    !episode.speakerTracks || episode.speakerTracks.length === 0;

  function updateTrack(index: number, patch: Partial<SpeakerTrackAssignment>) {
    setTracks((current) =>
      current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry))
    );
  }

  function addTrack() {
    const next = tracks.reduce((max, entry) => Math.max(max, entry.track), 0) + 1;
    setTracks([...tracks, { track: next, label: "" }]);
  }

  async function handleUpload() {
    if (!file) return;

    setUploading(true);
    setError(null);
    setMessage(null);

    try {
      const { uploadUrl } = await api.getTracksUploadUrl(
        episode.id,
        file.type || "application/zip",
        file.size
      );

      await uploadToR2(uploadUrl, file, setProgress);
      await api.completeTracksUpload(episode.id, tracks);

      setFile(null);
      setProgress(null);
      setMessage("話者トラックをアップロードしました");
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "アップロードに失敗しました");
    } finally {
      setUploading(false);
    }
  }

  async function handleSaveAssignment() {
    setError(null);
    setMessage(null);

    try {
      await api.completeTracksUpload(episode.id, tracks);
      setMessage("割り当てを保存しました");
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    }
  }

  async function handleDelete() {
    if (!confirm("アップロード済みの話者トラックを削除します。よろしいですか?")) {
      return;
    }

    setDeleting(true);
    setError(null);
    setMessage(null);

    try {
      await api.deleteTracks(episode.id);
      setMessage("話者トラックを削除しました");
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除に失敗しました");
    } finally {
      setDeleting(false);
    }
  }

  async function handleReprocess() {
    setReprocessing(true);
    setError(null);
    setMessage(null);

    try {
      const result = await api.reprocessTranscript(episode.id);
      const applied = result.applied
        .map((rule) => `${rule.from}→${rule.to} ${rule.count}件`)
        .join("、");

      setMessage(
        `文字起こしを作り直しました（${result.segments} セグメント）` +
          (applied ? `。置き換え: ${applied}` : "")
      );
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "再処理に失敗しました");
    } finally {
      setReprocessing(false);
    }
  }

  return (
    <div className="space-y-3">
      {message && (
        <div className="card p-3 border-[var(--color-success)]! bg-[var(--color-success-muted)]">
          <p className="text-sm text-[var(--color-success)]">{message}</p>
        </div>
      )}
      {error && (
        <div className="card p-3 border-[var(--color-error)]! bg-[var(--color-error-muted)]">
          <p className="text-sm text-[var(--color-error)]">{error}</p>
        </div>
      )}

      {hasTracks ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-[var(--color-text-secondary)]">
            アップロード済み（
            {new Date(episode.tracksUploadedAt!).toLocaleString("ja-JP")}）
          </p>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="btn btn-ghost text-[var(--color-error)]"
          >
            {deleting ? "削除中..." : "削除"}
          </button>
        </div>
      ) : (
        <p className="text-sm text-[var(--color-text-muted)]">
          話者ごとに分かれた音声トラックの zip
          をアップロードすると、文字起こしに話者名が付きます。
        </p>
      )}

      {/* トラックの割り当て */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="label mb-0">トラックの割り当て</span>
          {usingDefaults && (
            <span className="text-xs text-[var(--color-text-muted)]">
              番組の既定を使用中
            </span>
          )}
        </div>

        {tracks.map((entry, index) => (
          <div key={index} className="flex items-center gap-2">
            <div className="w-20 flex-shrink-0">
              <input
                type="number"
                min={1}
                value={entry.track}
                onChange={(e) =>
                  updateTrack(index, { track: parseInt(e.target.value, 10) || 1 })
                }
                className="input"
              />
            </div>
            <div className="flex-1 min-w-0">
              <input
                type="text"
                value={entry.label ?? ""}
                onChange={(e) => updateTrack(index, { label: e.target.value })}
                placeholder="話者名（空欄で BGM 扱い）"
                className="input"
              />
            </div>
            <button
              type="button"
              onClick={() => setTracks(tracks.filter((_, i) => i !== index))}
              className="btn btn-ghost text-[var(--color-error)] flex-shrink-0 whitespace-nowrap"
            >
              削除
            </button>
          </div>
        ))}

        <div className="flex gap-2">
          <button type="button" onClick={addTrack} className="btn btn-ghost">
            トラックを追加
          </button>
          {hasTracks && (
            <button
              type="button"
              onClick={handleSaveAssignment}
              className="btn btn-secondary"
            >
              割り当てを保存
            </button>
          )}
        </div>
      </div>

      {/* zip のアップロード */}
      <div className="space-y-2">
        <input
          type="file"
          accept=".zip,application/zip"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm"
        />

        {file && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-[var(--color-text-secondary)]">
              {file.name}（{(file.size / 1024 / 1024).toFixed(1)} MB）
            </span>
            <button
              type="button"
              onClick={handleUpload}
              disabled={uploading}
              className="btn btn-primary"
            >
              {uploading ? "アップロード中..." : "アップロード"}
            </button>
          </div>
        )}

        {uploading && progress && <UploadProgressBar progress={progress} />}
      </div>

      {/* 後処理のやり直し */}
      {episode.transcriptUrl && (
        <div className="border-t border-[var(--color-border)] pt-3">
          <button
            type="button"
            onClick={handleReprocess}
            disabled={reprocessing}
            className="btn btn-secondary"
          >
            {reprocessing ? "処理中..." : "文字起こしを作り直す"}
          </button>
          <p className="text-xs text-[var(--color-text-muted)] mt-2">
            文字起こし自体はやり直さず、統合の条件と誤字の辞書だけを適用し直します。
          </p>
        </div>
      )}
    </div>
  );
}
