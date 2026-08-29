import { useState } from "react";
import JSZip from "jszip";
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

/** zip 内で音声トラックとして扱う拡張子 */
const AUDIO_EXTENSIONS = [".wav", ".mp3", ".m4a", ".flac", ".aiff", ".aif", ".ogg"];

/** "cast_0285 - Track 2.wav" のようなファイル名からトラック番号を拾う */
const TRACK_NUMBER_PATTERN = /track[\s_-]*(\d+)/i;

interface DetectedTrack {
  track: number;
  /** zip 内のファイル名（何が入っているか分かるように見せる） */
  filename: string;
}

/**
 * zip を読んで、入っている音声トラックを列挙する
 *
 * 文字起こしワーカー側と同じ規則で番号を決める。番号が読めないファイルが混ざって
 * いる場合は、ワーカー側と同様にファイル名順の連番にフォールバックする。
 */
async function detectTracks(file: File): Promise<DetectedTrack[]> {
  const zip = await JSZip.loadAsync(file);

  const entries = Object.values(zip.files).filter((entry) => {
    if (entry.dir) return false;
    const name = entry.name;
    if (name.startsWith("__MACOSX/")) return false;

    const basename = name.split("/").pop() ?? "";
    if (basename.startsWith("._")) return false;

    return AUDIO_EXTENSIONS.some((ext) => basename.toLowerCase().endsWith(ext));
  });

  if (entries.length === 0) {
    throw new Error("zip の中に音声ファイルが見つかりません");
  }

  const numbers = entries.map((entry) => {
    const basename = entry.name.split("/").pop() ?? "";
    const match = basename.match(TRACK_NUMBER_PATTERN);
    return match ? parseInt(match[1], 10) : null;
  });

  const allNumbered = numbers.every((n) => n !== null);
  const unique = new Set(numbers).size === numbers.length;

  if (!allNumbered || !unique) {
    // ファイル名から番号を決められないのでファイル名順の連番にする
    return entries
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry, i) => ({
        track: i + 1,
        filename: entry.name.split("/").pop() ?? entry.name,
      }));
  }

  return entries
    .map((entry, i) => ({
      track: numbers[i] as number,
      filename: entry.name.split("/").pop() ?? entry.name,
    }))
    .sort((a, b) => a.track - b.track);
}

/**
 * 話者トラック（zip）のアップロードと、トラックへの話者の割り当て
 *
 * 話者ごとに分かれた音声があれば、区間ごとの音量を比べて誰が喋っているかを判定できる。
 * 番組の既定値で足りることが多いが、ゲスト回はトラック構成が変わるのでここで上書きする。
 */
export function SpeakerTracksPanel({ episode, defaults, onUpdated }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [detected, setDetected] = useState<DetectedTrack[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reprocessing, setReprocessing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [retranscribing, setRetranscribing] = useState(false);

  // エピソード固有の指定が無ければ番組の既定値を編集の出発点にする
  const [tracks, setTracks] = useState<SpeakerTrackAssignment[]>(
    episode.speakerTracks && episode.speakerTracks.length > 0
      ? episode.speakerTracks
      : defaults
  );

  const hasTracks = Boolean(episode.tracksUploadedAt);
  const usingDefaults = !episode.speakerTracks || episode.speakerTracks.length === 0;

  function updateTrack(index: number, patch: Partial<SpeakerTrackAssignment>) {
    setTracks((current) =>
      current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry))
    );
  }

  /**
   * zip が選ばれたら中身を読んでトラックを並べる
   *
   * 手で 1 つずつ追加させると、zip に何本入っているかを人が数えることになる。
   * 名前は既にある割り当て（エピソード固有 → 番組の既定）から引き継ぐ。
   */
  async function handleFileSelect(selected: File | null) {
    setFile(selected);
    setDetected(null);
    setError(null);
    setMessage(null);

    if (!selected) return;

    try {
      const found = await detectTracks(selected);
      setDetected(found);

      const known = new Map(tracks.map((t) => [t.track, t.label]));
      setTracks(
        found.map((t) => ({
          track: t.track,
          label: known.get(t.track) ?? "",
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "zip を読めませんでした");
    }
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
      setDetected(null);
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

  async function handleRetranscribe() {
    if (
      !confirm(
        "音声から文字起こしをやり直します。\n" +
          "現在の文字起こしは新しい結果で置き換わります。よろしいですか?"
      )
    ) {
      return;
    }

    setRetranscribing(true);
    setError(null);
    setMessage(null);

    try {
      await api.retranscribe(episode.id);
      setMessage(
        "文字起こしの待ち行列に入れました。ワーカーが取得すると処理が始まります。"
      );
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "やり直しに失敗しました");
    } finally {
      setRetranscribing(false);
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

  const isQueued =
    episode.transcribeStatus === "pending" ||
    episode.transcribeStatus === "transcribing";

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

      {/* zip の選択 */}
      <div className="space-y-2">
        <input
          type="file"
          accept=".zip,application/zip"
          onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
          className="text-sm"
        />

        {file && (
          <p className="text-sm text-[var(--color-text-secondary)]">
            {file.name}（{(file.size / 1024 / 1024).toFixed(1)} MB
            {detected && `・${detected.length} トラック`}）
          </p>
        )}
      </div>

      {/* トラックの割り当て */}
      {tracks.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="label mb-0">話者の割り当て</span>
            {!detected && usingDefaults && (
              <span className="text-xs text-[var(--color-text-muted)]">
                番組の既定を使用中
              </span>
            )}
          </div>

          {detected && (
            <p className="text-xs text-[var(--color-text-muted)]">
              zip の中身から検出しました。喋っていないトラック（BGM
              など）は名前を空にしてください。
            </p>
          )}

          {tracks.map((entry, index) => (
            <div key={entry.track} className="flex items-center gap-2">
              <span className="shrink-0 w-28 text-xs text-[var(--color-text-muted)] truncate">
                {detected?.[index]?.filename ?? `トラック ${entry.track}`}
              </span>
              <div className="flex-1 min-w-0">
                <input
                  type="text"
                  value={entry.label ?? ""}
                  onChange={(e) => updateTrack(index, { label: e.target.value })}
                  placeholder="話者名（空欄で BGM 扱い）"
                  className="input"
                />
              </div>
            </div>
          ))}

          {hasTracks && !file && (
            <button
              type="button"
              onClick={handleSaveAssignment}
              className="btn btn-secondary"
            >
              割り当てを保存
            </button>
          )}
        </div>
      )}

      {/* アップロード */}
      {file && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleUpload}
            disabled={uploading || !detected}
            className="btn btn-primary"
          >
            {uploading ? "アップロード中..." : "アップロード"}
          </button>
          {uploading && progress && <UploadProgressBar progress={progress} />}
        </div>
      )}

      {/* やり直し */}
      {episode.transcriptUrl && (
        <div className="border-t border-[var(--color-border)] pt-3 space-y-4">
          <div>
            <button
              type="button"
              onClick={handleReprocess}
              disabled={reprocessing}
              className="btn btn-secondary"
            >
              {reprocessing ? "処理中..." : "後処理だけやり直す"}
            </button>
            <p className="text-xs text-[var(--color-text-muted)] mt-2">
              文字起こしはそのままに、統合の条件と誤字の辞書だけを適用し直します。すぐ終わります。
            </p>
          </div>

          <div>
            <button
              type="button"
              onClick={handleRetranscribe}
              disabled={retranscribing || isQueued}
              className="btn btn-secondary"
            >
              {retranscribing ? "登録中..." : "音声から文字起こしをやり直す"}
            </button>
            <p className="text-xs text-[var(--color-text-muted)] mt-2">
              {isQueued
                ? "すでに待ち行列に入っています。"
                : "話者トラックを後から用意した場合はこちら。話者を付けるには音声から取り直す必要があります。"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
