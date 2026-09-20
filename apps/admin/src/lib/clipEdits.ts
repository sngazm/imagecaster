/**
 * 下書きへの直し。どれも「元の書き起こしの文字（of）を連ねたもの」を変えない。
 *
 * 動画を描く側は、of を連ねたものが元の書き起こしと一字一句一致することを確かめてから
 * 描く。字幕と音がずれるのを防ぐ関門で、ここで崩すと OK を出したあとの描画で止まる。
 * Worker も保存のときに同じことを確かめる。
 */

import type { ClipDraft, ClipDraftSub, ClipSpan } from "./api";
import type { GlyphTable } from "./clipGlyphs";
import { buildTimeline, placeSubs } from "./clipTimeline";

const codePoints = (s: string) => [...s];

/** テキストエリアの文字を、画面の行にする。空行は行として数えない */
export const toRows = (text: string) =>
  text
    .split("\n")
    .map((r) => r.trim())
    .filter((r) => r !== "");

export const isEdited = (sub: ClipDraftSub) => sub.rows.join("") !== sub.of;

function freshId(subs: ClipDraftSub[], base: string): string {
  const used = new Set(subs.map((s) => s.id));
  for (let i = 1; ; i++) {
    const id = `${base}-${i}`;
    if (!used.has(id)) return id;
  }
}

/**
 * 枚を 2 つに割る。at は rows を連ねた文字列の上での位置（コードポイント）。
 *
 * 文字を直した枚は割れない。直したあとの文字のどこが元の文字のどこに当たるかが
 * 決まらず、読み上げの時刻を分けられないため。割ってから直す。
 */
export function splitSub(draft: ClipDraft, id: string, at: number): ClipDraft | null {
  const i = draft.subs.findIndex((s) => s.id === id);
  const sub = draft.subs[i];
  if (!sub || isEdited(sub)) return null;
  const chars = codePoints(sub.of);
  if (at <= 0 || at >= chars.length) return null;

  // 行の切れ目は保つ。割る位置をまたぐ行だけが 2 つに分かれる
  const before: string[] = [];
  const after: string[] = [];
  let seen = 0;
  for (const row of sub.rows) {
    const cps = codePoints(row);
    if (seen + cps.length <= at) before.push(row);
    else if (seen >= at) after.push(row);
    else {
      before.push(cps.slice(0, at - seen).join(""));
      after.push(cps.slice(at - seen).join(""));
    }
    seen += cps.length;
  }

  const boundary = sub.chars[at];
  const first: ClipDraftSub = {
    ...sub,
    id: freshId(draft.subs, sub.id),
    of: chars.slice(0, at).join(""),
    chars: sub.chars.slice(0, at),
    rows: before,
    end: boundary,
  };
  const second: ClipDraftSub = {
    ...sub,
    id: freshId([...draft.subs, first], sub.id),
    of: chars.slice(at).join(""),
    chars: sub.chars.slice(at),
    rows: after,
    start: boundary,
  };
  const subs = [...draft.subs];
  subs.splice(i, 1, first, second);
  return { ...draft, subs };
}

/** 前の枚と繋ぐ。足した字幕（of が空）は時刻の持ち方が違うので繋げない */
export function mergeWithPrevious(draft: ClipDraft, id: string): ClipDraft | null {
  const i = draft.subs.findIndex((s) => s.id === id);
  const prev = draft.subs[i - 1];
  const sub = draft.subs[i];
  if (!prev || !sub || prev.of === "" || sub.of === "") return null;

  const merged: ClipDraftSub = {
    ...prev,
    end: sub.end,
    of: prev.of + sub.of,
    chars: [...prev.chars, ...sub.chars],
    rows: [...prev.rows, ...sub.rows],
    skip: prev.skip && sub.skip,
  };
  const subs = [...draft.subs];
  subs.splice(i - 1, 2, merged);
  return { ...draft, subs };
}

/** 足した字幕が入る隙間に必要な長さ（秒）。これより短いと読めない */
export const MIN_INSERT_GAP = 0.4;

/** この枚のあとに、元の書き起こしに無い字幕を足せる隙間。無ければ null */
export function gapAfter(draft: ClipDraft, id: string): [number, number] | null {
  const i = draft.subs.findIndex((s) => s.id === id);
  const sub = draft.subs[i];
  if (!sub) return null;
  const next = draft.subs[i + 1];
  const end = Math.min(next ? next.start : sub.end + 1.5, sub.end + 1.5);
  return end - sub.end >= MIN_INSERT_GAP ? [sub.end, end] : null;
}

export function insertAfter(draft: ClipDraft, id: string, speaker: string): ClipDraft | null {
  const gap = gapAfter(draft, id);
  if (!gap) return null;
  const i = draft.subs.findIndex((s) => s.id === id);
  const added: ClipDraftSub = {
    id: freshId(draft.subs, "n"),
    speaker,
    start: gap[0],
    end: gap[1],
    of: "",
    chars: [],
    rows: ["（ここに字幕）"],
    skip: false,
  };
  const subs = [...draft.subs];
  subs.splice(i + 1, 0, added);
  return { ...draft, subs };
}

/** 足した字幕を取り除く。元の書き起こしから来た枚は消せない（出さないなら skip） */
export function removeInserted(draft: ClipDraft, id: string): ClipDraft | null {
  const sub = draft.subs.find((s) => s.id === id);
  if (!sub || sub.of !== "") return null;
  return { ...draft, subs: draft.subs.filter((s) => s.id !== id) };
}

// ---------------------------------------------------------------------------
// 区間
//
// どこをどの順に繋ぐかは手元の AI が決める。ここでやるのは微調整だけ：まとまりの端を
// 字幕 1 枚ぶん伸び縮みさせる、端を少し寄せる、間を変える、まとまりを外す／戻す。
// ---------------------------------------------------------------------------

export interface SpanGroup {
  id: string;
  note?: string;
  spans: ClipSpan[];
  off: boolean;
}

/** まとまりを、鳴らす順に */
export function spanGroups(draft: ClipDraft): SpanGroup[] {
  const groups: SpanGroup[] = [];
  for (const span of draft.spans) {
    let g = groups.find((x) => x.id === span.group);
    if (!g) {
      g = { id: span.group, note: undefined, spans: [], off: true };
      groups.push(g);
    }
    g.spans.push(span);
    g.note ??= span.note;
    if (!span.off) g.off = false;
  }
  return groups;
}

const firstChar = (s: ClipDraftSub) => (s.chars.length ? s.chars[0] : s.start);
const lastChar = (s: ClipDraftSub) => (s.chars.length ? s.chars[s.chars.length - 1] : s.start);
const insideSpan = (sub: ClipDraftSub, span: ClipSpan) =>
  firstChar(sub) >= span.start && lastChar(sub) < span.end;

export type Edge = "head" | "tail";

/** まとまりの端の区間。頭なら最初の、尻なら最後の区間 */
function edgeSpan(draft: ClipDraft, groupId: string, edge: Edge): ClipSpan | null {
  const spans = draft.spans.filter((s) => s.group === groupId && !s.off);
  return (edge === "head" ? spans[0] : spans[spans.length - 1]) ?? null;
}

/**
 * 端をどこまで動かせるか。
 *
 * 外へは、pool の端・ほかの鳴らす区間・区間に入っていない隣の字幕の読み上げまで。
 * 内へは、区間の中のいちばん端の字幕の読み上げまで。読み上げに食い込むと、その枚は
 * 「一部だけ入っている」ことになって出せなくなる。
 */
export function edgeLimits(draft: ClipDraft, span: ClipSpan, edge: Edge): [number, number] {
  const pool = draft.pool.find((p) => span.start >= p.start && span.end <= p.end)!;
  const others = draft.spans.filter((s) => s.id !== span.id && !s.off);
  const inside = draft.subs.filter((s) => insideSpan(s, span));

  if (edge === "head") {
    const before = draft.subs.filter((s) => lastChar(s) < span.start);
    const outer = Math.max(
      pool.start,
      ...others.filter((s) => s.end <= span.start).map((s) => s.end),
      ...before.slice(-1).map((s) => Math.min(s.end, span.start))
    );
    const inner = inside.length ? firstChar(inside[0]) : span.end - 0.1;
    return [outer, inner];
  }
  const after = draft.subs.filter((s) => firstChar(s) > span.end);
  const outer = Math.min(
    pool.end,
    ...others.filter((s) => s.start >= span.end).map((s) => s.start),
    ...after.slice(0, 1).map((s) => firstChar(s))
  );
  const inner = inside.length ? Math.max(lastChar(inside[inside.length - 1]), span.start + 0.1) : span.start + 0.1;
  return [inner, outer];
}

const patchSpan = (draft: ClipDraft, id: string, change: Partial<ClipSpan>): ClipDraft => ({
  ...draft,
  spans: draft.spans.map((s) => (s.id === id ? { ...s, ...change } : s)),
});

/** 端を少し寄せる（秒）。動かせる範囲の外へは出ない */
export function nudgeEdge(draft: ClipDraft, groupId: string, edge: Edge, delta: number): ClipDraft | null {
  const span = edgeSpan(draft, groupId, edge);
  if (!span) return null;
  const [lo, hi] = edgeLimits(draft, span, edge);
  const key = edge === "head" ? "start" : "end";
  const next = Math.max(lo, Math.min(hi, span[key] + delta));
  if (Math.abs(next - span[key]) < 1e-9) return null;
  return patchSpan(draft, span.id, { [key]: Math.round(next * 1000) / 1000 });
}

/**
 * 端を字幕 1 枚ぶん動かす。grow なら隣の枚を取り込み、そうでなければ端の枚を外す。
 *
 * 取り込むときは、その枚の頭の手前に lead、尻のあとに trail の余白を付ける。字幕の start は
 * 最初の字が鳴り始めた時刻なので、そこちょうどで切ると頭の子音が食われる。
 *
 * まとまりは、無音を詰めたところで複数の区間に割れている。字幕 1 枚がその継ぎ目を
 * またぐこともある。だから区間 1 つではなく、まとまり全体を見て動かす：外すときは
 * 新しい端より外にある区間を丸ごと外し、端をまたぐ区間だけを縮める。
 */
export function stepEdge(draft: ClipDraft, groupId: string, edge: Edge, grow: boolean): ClipDraft | null {
  const mine = draft.spans.filter((s) => s.group === groupId && !s.off);
  if (mine.length === 0) return null;
  const head = edge === "head";
  const tip = head ? mine[0] : mine[mine.length - 1];
  const pool = draft.pool.find((p) => tip.start >= p.start && tip.end <= p.end)!;
  const others = draft.spans.filter((s) => s.group !== groupId && !s.off);
  const within = (t: number, spans: ClipSpan[]) => spans.some((sp) => t >= sp.start && t < sp.end);
  const marks = (sub: ClipDraftSub) => (sub.chars.length ? sub.chars : [sub.start]);

  if (grow) {
    const free = (sub: ClipDraftSub) =>
      firstChar(sub) >= pool.start && sub.end <= pool.end && !marks(sub).some((t) => within(t, others));
    const sub = head
      ? [...draft.subs].reverse().find((s) => lastChar(s) < tip.start && free(s))
      : draft.subs.find((s) => firstChar(s) >= tip.end && free(s));
    if (!sub) return null;
    const i = draft.subs.indexOf(sub);

    let spans: ClipSpan[];
    if (head) {
      const prev = draft.subs[i - 1];
      const floor = Math.max(
        pool.start,
        prev ? Math.min(prev.end, firstChar(sub)) : pool.start,
        ...others.filter((s) => s.end <= firstChar(sub)).map((s) => s.end)
      );
      const start = round3(Math.max(floor, firstChar(sub) - draft.lead));
      // 外してあった自分の区間を覆ってしまうなら、それは取り除く。残すと同じ音が二重に載る
      spans = draft.spans
        .filter((s) => !(s.group === groupId && s.off && s.end > start && s.start < tip.end))
        .map((s) => (s.id === tip.id ? { ...s, start } : s));
    } else {
      const next = draft.subs[i + 1];
      const ceil = Math.min(
        pool.end,
        next ? Math.max(firstChar(next), sub.end) : pool.end,
        ...others.filter((s) => s.start >= sub.end).map((s) => s.start)
      );
      const end = round3(Math.min(ceil, sub.end + draft.trail));
      spans = draft.spans
        .filter((s) => !(s.group === groupId && s.off && s.start < end && s.end > tip.start))
        .map((s) => (s.id === tip.id ? { ...s, end } : s));
    }
    return { ...draft, spans };
  }

  // 外す。まとまりに丸ごと入っている枚が 2 つ以上要る（最後の 1 枚は「外す」で）
  const inside = draft.subs.filter((s) => marks(s).every((t) => within(t, mine)));
  if (inside.length < 2) return null;

  if (head) {
    const boundary = round3(Math.max(inside[0].end, firstChar(inside[1]) - draft.lead));
    const spans = draft.spans.map((s) => {
      if (s.group !== groupId || s.off) return s;
      if (s.end <= boundary) return { ...s, off: true };
      return s.start < boundary ? { ...s, start: boundary } : s;
    });
    return { ...draft, spans };
  }

  const keep = inside[inside.length - 2];
  const boundary = round3(Math.min(firstChar(inside[inside.length - 1]), keep.end + draft.trail));
  // まとまりのあとの間は、最後の区間が持っている。最後の区間が替わるなら引き継ぐ
  const groupGap = tip.gap;
  const kept = mine.filter((s) => s.start < boundary);
  const newTip = kept[kept.length - 1];
  const spans = draft.spans.map((s) => {
    if (s.group !== groupId || s.off) return s;
    if (s.start >= boundary) return { ...s, off: true };
    const next = s.end > boundary ? { ...s, end: boundary } : s;
    return s.id === newTip.id ? { ...next, gap: groupGap } : next;
  });
  return { ...draft, spans };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** まとまりを丸ごと外す／戻す */
export function toggleGroup(draft: ClipDraft, groupId: string): ClipDraft | null {
  const group = spanGroups(draft).find((g) => g.id === groupId);
  if (!group) return null;
  const off = !group.off;
  // 全部外すと鳴らすものが無くなる
  if (off && draft.spans.every((s) => s.off || s.group === groupId)) return null;
  return { ...draft, spans: draft.spans.map((s) => (s.group === groupId ? { ...s, off } : s)) };
}

/** まとまりのあとに挟む間 */
export function setGroupGap(draft: ClipDraft, groupId: string, gap: number | null): ClipDraft | null {
  const spans = draft.spans.filter((s) => s.group === groupId && !s.off);
  const last = spans[spans.length - 1];
  return last ? patchSpan(draft, last.id, { gap }) : null;
}

export interface SubProblem {
  subId: string;
  message: string;
}

/** 手元の字幕エディタと同じ上限。3 行以上は画面を塞ぐ */
const MAX_ROWS = 2;

/**
 * このまま描くと困ること。1 つでもあれば OK を出させない。
 *
 * 動画に入る枚だけを見る。区間の外や、出さない枚に問題があっても描画には出ない。
 */
export function draftProblems(draft: ClipDraft, table: GlyphTable): SubProblem[] {
  const out: SubProblem[] = [];
  const { shown, partial } = placeSubs(draft, buildTimeline(draft));
  for (const sub of partial) {
    out.push({ subId: sub.id, message: "区間の端がこの字幕の途中にあります。端を動かすか、先に枚を割ってください" });
  }
  for (const { sub } of shown) {
    if (sub.rows.length === 0) out.push({ subId: sub.id, message: "文字がありません" });
    if (sub.rows.length > MAX_ROWS) {
      out.push({ subId: sub.id, message: `${sub.rows.length} 行あります（${MAX_ROWS} 行まで）` });
    }
    for (const row of sub.rows) {
      if (table.overflows(row)) {
        const over = table.rowEm(row) - table.metrics.maxEm;
        out.push({ subId: sub.id, message: `「${row}」が幅に入りません（${over.toFixed(1)} 字ぶん）` });
      }
      const missing = [...new Set(table.missing(row))];
      if (missing.length) {
        out.push({
          subId: sub.id,
          message: `${missing.join(" ")} はフォントに無い字です。動画では別の形で出ます`,
        });
      }
    }
  }
  return out;
}
