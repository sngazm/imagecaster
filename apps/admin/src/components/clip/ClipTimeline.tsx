import { useEffect, useRef } from "react";
import type { PlacedSub, Timeline } from "../../lib/clipTimeline";

/**
 * 繋いだあとの時間を帯で見せる。背景の区切りが継ぎ目、上に載る帯が字幕 1 枚。
 *
 * ここでは端を動かさない。端はまとまりごとに、字幕リストの側で動かす。繋いだあとの帯の
 * 上では、外へ伸ばした先に何があるのか（どの字幕が入ってくるのか）が見えないため。
 */

interface Props {
  timeline: Timeline;
  shown: PlacedSub[];
  currentId: string | null;
  getTime: () => number;
  onSeek: (tau: number) => void;
}

/** まとまりが替わるたびに色の濃さを替える。どこからどこまでがひとまとまりかが見える */
const GROUP_SHADES = ["rgba(255,255,255,0.10)", "rgba(255,255,255,0.04)"];

export function ClipTimeline({ timeline, shown, currentId, getTime, onSeek }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const total = Math.max(timeline.duration, 1e-6);
  const pct = (tau: number) => `${(tau / total) * 100}%`;

  // 再生位置の線は React を通さずに動かす。毎フレーム state を更新すると、
  // 字幕リストまで毎フレーム描き直すことになる
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (headRef.current) headRef.current.style.left = `${(getTime() / total) * 100}%`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [total, getTime]);

  let shade = -1;
  let lastGroup: string | null = null;

  return (
    <div
      ref={trackRef}
      className="relative h-10 w-full select-none overflow-hidden rounded bg-[var(--color-bg-hover)]"
      onPointerDown={(e) => {
        const rect = trackRef.current!.getBoundingClientRect();
        onSeek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * total);
      }}
    >
      {timeline.pieces.map((p) => {
        if (p.span.group !== lastGroup) {
          shade++;
          lastGroup = p.span.group;
        }
        return (
          <div
            key={p.span.id}
            className="absolute inset-y-0"
            style={{
              left: pct(p.tau),
              width: pct(p.span.end - p.span.start),
              background: GROUP_SHADES[shade % 2],
              borderLeft: "1px solid rgba(255,255,255,0.25)",
            }}
          />
        );
      })}
      {shown.map(({ sub, start, end }) => (
        <div
          key={sub.id}
          className="absolute top-2.5 h-5 rounded-sm"
          style={{
            left: pct(start),
            width: `max(2px, calc(${pct(end - start)} - 1px))`,
            background: "var(--color-accent)",
            opacity: sub.id === currentId ? 1 : 0.5,
          }}
        />
      ))}
      <div ref={headRef} className="pointer-events-none absolute top-0 z-10 h-full w-px bg-white" />
    </div>
  );
}
