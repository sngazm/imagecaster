import { useState } from "react";
import type { TranscriptSegment } from "../lib/api";

interface Props {
  segments: TranscriptSegment[];
  /** 元ファイルへのリンクも出すか（VTTをそのまま欲しいとき用） */
  sourceUrl?: string | null;
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

export function TranscriptViewer({ segments, sourceUrl }: Props) {
  const [open, setOpen] = useState(false);

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
      </div>

      {open && (
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
