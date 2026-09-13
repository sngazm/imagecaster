import { useEffect, useMemo, useState } from "react";
import type { RawSegment,
  TranscriptSegment } from "../lib/api";
import { timeToSeconds } from "../lib/api";

interface Props {
  segments: TranscriptSegment[];
  /** 元ファイルへのリンクも出すか（VTTをそのまま欲しいとき用） */
  sourceUrl?: string | null;
  /** Whisper の生出力。整形で何が変わったかを見るのに使う */
  rawUrl?: string | null;
  /**
   * 行をクリックしたところから再生するための音声要素。無ければ読むだけ。
   *
   * プレイヤーは親が持っている（音声の差し替えもそこでやる）ので、要素を
   * 借りて位置だけ動かす。公開サイトと同じ操作感にしておく。
   */
  audio?: HTMLAudioElement | null;
}

/**
 * 0:15:33 / 1:13:45 のように、時間の桁を常に出す。
 *
 * 1 時間を超える回があるので、途中で桁が増えると読みづらい。formatDuration は
 * 一覧向けに短く出すので、ここでは使わない。
 */
function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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

export function TranscriptViewer({ segments, sourceUrl, rawUrl, audio }: Props) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState<RawSegment[] | null>(null);
  const [comparing, setComparing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 音声の状態。止めるボタンと現在位置を出し、流れている行を強調するため
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!audio) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setNow(audio.currentTime);
    const onDuration = () =>
      setTotal(Number.isFinite(audio.duration) ? audio.duration : 0);

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onPause);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("durationchange", onDuration);

    // 既に読み込み済み・再生中のこともある
    onDuration();
    setPlaying(!audio.paused);

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onPause);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("durationchange", onDuration);
    };
  }, [audio]);

  /**
   * いま流れている行。
   *
   * 行は開始時刻しか持たないので、「現在より前で、いちばん後ろに始まった行」を
   * 今の行とみなす。行数が数百あるので二分探索で引く。
   */
  const starts = useMemo(() => segments.map((s) => timeToSeconds(s.start)), [segments]);

  const playingIndex = useMemo(() => {
    if (!playing) return -1;

    let low = 0;
    let high = starts.length - 1;
    let found = -1;

    while (low <= high) {
      const mid = (low + high) >> 1;
      if (starts[mid] <= now) {
        found = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return found;
  }, [playing, now, starts]);

  /**
   * 行をクリックしたところから再生する。
   *
   * 文字はコピーできる必要があるので、選択しただけのときは動かさない。
   * 読み返している最中に音が鳴り出すと邪魔になる。
   */
  function playFrom(segment: TranscriptSegment): void {
    if (!audio) return;
    if (!window.getSelection()?.isCollapsed) return;

    audio.currentTime = timeToSeconds(segment.start);
    void audio.play();
  }

  /** 止めて先頭に戻す */
  function stop(): void {
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
  }

  /**
   * Whisper の生出力を読み込む。
   *
   * 整形で何が消えたか・誰の発言になったかを確かめるのに使う。
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

      // 公開行より前に終わる生の行は、整形で消えたもの
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

        {/* 再生中だけ出る。止めるボタンと、いまどこを聞いているか */}
        {audio && playing && (
          <span className="inline-flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <button
              type="button"
              onClick={stop}
              aria-label="再生を止める"
              title="再生を止める"
              className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg-elevated)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            >
              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="7" y="7" width="10" height="10" rx="1.5" />
              </svg>
            </button>
            <span className="font-mono tabular-nums">
              {formatClock(now)} / {formatClock(total)}
            </span>
          </span>
        )}
      </div>

      {loadError && (
        <p className="mt-2 text-xs text-[var(--color-danger)]">{loadError}</p>
      )}

      {open && comparing && raw && (
        <div className="mt-3 max-h-96 overflow-y-auto overflow-x-hidden pr-2">
          <p className="mb-2 text-xs text-[var(--color-text-muted)]">
            左が Whisper の生出力、右が公開されているもの。
            <span className="text-[var(--color-danger)]">赤</span>は整形で消えた行、
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
                onClick={audio ? () => playFrom(segment) : undefined}
                className={`-mx-2 flex gap-3 rounded px-2 py-1 transition-colors ${
                  isNewSpeaker && index > 0 ? "mt-3" : ""
                } ${audio ? "cursor-pointer hover:bg-[var(--color-accent)]/10" : ""} ${
                  playingIndex === index ? "bg-[var(--color-accent)]/10" : ""
                }`}
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
                <p className="cursor-text text-sm leading-relaxed text-[var(--color-text-secondary)]">
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
