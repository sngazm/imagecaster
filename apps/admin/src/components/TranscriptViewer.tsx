import { useState } from "react";
import type { RawSegment,
  TranscriptSegment } from "../lib/api";
import { timeToSeconds } from "../lib/api";

interface Props {
  segments: TranscriptSegment[];
  /** 元ファイルへのリンクも出すか（VTTをそのまま欲しいとき用） */
  sourceUrl?: string | null;
  /** Whisper の生出力。後処理で何が変わったかを見るのに使う */
  rawUrl?: string | null;
}

/** 話者ごとの色。登場順に割り当てる */
const SPEAKER_CLASSES = [
  "text-[var(--color-speaker-1)]",
  "text-[var(--color-speaker-2)]",
  "text-[var(--color-speaker-3)]",
  "text-[var(--color-speaker-4)]",
];

/** 同時発話は「あずま・鉄塔」のように中黒で連結されて届く */
const SIMULTANEOUS_SEPARATOR = "・";

export function TranscriptViewer({ segments, sourceUrl, rawUrl }: Props) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState<RawSegment[] | null>(null);
  const [comparing, setComparing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  /**
   * Whisper の生出力を読み込む。
   *
   * 後処理で何が消えたか・誰の発言になったかを確かめるのに使う。
   * 「そうですね。」が相槌として消えているのか、そもそも文字起こしされて
   * いないのかは、生と比べないと分からない。
   */
  async function loadRaw(): Promise<void> {
    if (!rawUrl || raw) {
      setComparing(!comparing);
      return;
    }

    setLoadError(null);
    try {
      const response = await fetch(rawUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = (await response.json()) as { segments: RawSegment[] };
      setRaw(data.segments ?? []);
      setComparing(true);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "生データを読めませんでした");
    }
  }

  /** 公開されている行と、その時間に重なる生の行を組にする */
  function pair(): Array<{ published: TranscriptSegment | null; raw: RawSegment[] }> {
    if (!raw) return [];

    const rows: Array<{ published: TranscriptSegment | null; raw: RawSegment[] }> = [];
    let cursor = 0;

    for (let i = 0; i < segments.length; i++) {
      const published = segments[i];
      const from = timeToSeconds(published.start);
      // 公開行は終わりの時刻を持たないので、次の行の始まりまでを範囲とする
      const to =
        i + 1 < segments.length ? timeToSeconds(segments[i + 1].start) : Infinity;

      const matched: RawSegment[] = [];

      // 公開行より前に終わる生の行は、後処理で消えたもの
      while (cursor < raw.length && raw[cursor].end <= from) {
        rows.push({ published: null, raw: [raw[cursor]] });
        cursor += 1;
      }

      while (cursor < raw.length && raw[cursor].start < to) {
        matched.push(raw[cursor]);
        cursor += 1;
      }

      rows.push({ published, raw: matched });
    }

    // 残りはすべて消されたもの
    while (cursor < raw.length) {
      rows.push({ published: null, raw: [raw[cursor]] });
      cursor += 1;
    }

    return rows;
  }

  const speakers = [
    ...new Set(
      segments.flatMap((s) =>
        s.speaker ? s.speaker.split(SIMULTANEOUS_SEPARATOR) : []
      )
    ),
  ];
  const hasSpeakers = speakers.length > 0;

  function speakerClass(name: string): string {
    return SPEAKER_CLASSES[speakers.indexOf(name) % SPEAKER_CLASSES.length];
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="inline-flex items-center gap-1.5 text-sm text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors"
        >
          <svg
            className={`w-4 h-4 transition-transform ${open ? "rotate-90" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
          文字起こしを見る
          <span className="text-xs text-[var(--color-text-muted)]">
            （{segments.length} 件{hasSpeakers && `・話者 ${speakers.length} 人`}）
          </span>
        </button>

        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
          >
            VTT ファイル
          </a>
        )}
        {rawUrl && open && (
          <button
            type="button"
            onClick={loadRaw}
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:underline"
          >
            {comparing ? "生データを隠す" : "Whisper の生出力と比べる"}
          </button>
        )}
      </div>

      {loadError && (
        <p className="mt-2 text-xs text-[var(--color-danger)]">{loadError}</p>
      )}

      {open && comparing && raw && (
        <div className="mt-3 max-h-96 overflow-y-auto overflow-x-hidden pr-2">
          <p className="mb-2 text-xs text-[var(--color-text-muted)]">
            左が Whisper の生出力、右が公開されているもの。
            <span className="text-[var(--color-danger)]">赤</span>は後処理で消えた行、
            <span className="text-[var(--color-accent)]">青</span>は話者が変わった行。
          </p>

          {pair().map((row, index) => {
            const dropped = row.published === null;
            const rawSpeakers = [...new Set(row.raw.map((r) => r.speaker ?? ""))];
            const moved =
              !dropped &&
              row.published?.speaker !== undefined &&
              rawSpeakers.length === 1 &&
              rawSpeakers[0] !== "" &&
              rawSpeakers[0] !== row.published.speaker;

            return (
              <div
                key={index}
                className={`grid grid-cols-2 gap-3 border-b border-[var(--color-border)] py-1.5 text-sm ${
                  dropped ? "opacity-60" : ""
                }`}
              >
                <div className="min-w-0">
                  {row.raw.map((r, i) => (
                    <p
                      key={i}
                      className={`leading-relaxed ${
                        dropped
                          ? "text-[var(--color-danger)] line-through"
                          : "text-[var(--color-text-muted)]"
                      }`}
                    >
                      <span className="mr-1.5 font-mono text-[10px] tabular-nums opacity-70">
                        {r.start.toFixed(1)}
                      </span>
                      {r.speaker && (
                        <span className={`mr-1 text-[11px] ${speakerClass(r.speaker)}`}>
                          {r.speaker}
                        </span>
                      )}
                      {r.text}
                    </p>
                  ))}
                </div>

                <div className="min-w-0">
                  {row.published && (
                    <p
                      className={`leading-relaxed ${
                        moved
                          ? "text-[var(--color-accent)]"
                          : "text-[var(--color-text-secondary)]"
                      }`}
                    >
                      {row.published.speaker && (
                        <span
                          className={`mr-1 text-[11px] ${speakerClass(row.published.speaker)}`}
                        >
                          {row.published.speaker}
                        </span>
                      )}
                      {row.published.text}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {open && !comparing && (
        <div className="mt-3 max-h-96 overflow-y-auto overflow-x-hidden pr-2">
          {segments.map((segment, index) => {
            // 話者が切り替わったときだけ名前を出す
            const isNewSpeaker =
              Boolean(segment.speaker) &&
              segment.speaker !== segments[index - 1]?.speaker;

            return (
              <div
                key={index}
                className={`flex gap-3 py-1 ${isNewSpeaker && index > 0 ? "mt-3" : ""}`}
              >
                <span className="shrink-0 w-24 pt-0.5">
                  <span className="block text-[10px] font-mono text-[var(--color-text-muted)]/70 tabular-nums">
                    {segment.start}
                  </span>
                  {isNewSpeaker &&
                    segment.speaker
                      ?.split(SIMULTANEOUS_SEPARATOR)
                      .map((name) => (
                        <span
                          key={name}
                          className={`block truncate text-[11px] font-medium leading-tight ${speakerClass(name)}`}
                        >
                          {name}
                        </span>
                      ))}
                </span>
                <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
                  {segment.text}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
