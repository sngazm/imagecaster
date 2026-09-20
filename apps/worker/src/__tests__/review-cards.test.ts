import { describe, it, expect } from "vitest";
import { SELF, env } from "cloudflare:test";
import type { ReviewCard, TranscriptData } from "../types";
import { pinnedSpan } from "../services/transcript-refine";
import { mergeIncomingCards, verificationHolds } from "../services/review-cards";

async function createEpisode(title: string): Promise<{ id: string; storageKey: string }> {
  const response = await SELF.fetch("http://localhost/api/episodes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, skipTranscription: false }),
  });

  const { id } = (await response.json()) as { id: string };
  // storageKey は作成の応答には無いので、詳細から取る
  const detail = (await (await SELF.fetch(`http://localhost/api/episodes/${id}`)).json()) as {
    storageKey: string;
  };

  return { id, storageKey: detail.storageKey };
}

/** 生データを置く。行は 10 秒おきに並べる */
async function putRawLines(storageKey: string, lines: string[]) {
  const data: TranscriptData = {
    segments: lines.map((text, i) => ({ start: i * 10, end: i * 10 + 5, text })),
    language: "ja",
  };

  await env.R2_BUCKET.put(`episodes/${storageKey}/transcript.raw.json`, JSON.stringify(data));
}

async function publishedLines(storageKey: string): Promise<string[]> {
  const obj = await env.R2_BUCKET.get(`episodes/${storageKey}/transcript.json`);
  return (JSON.parse(await obj!.text()) as TranscriptData).segments.map((s) => s.text);
}

function putCards(id: string, cards: unknown[]) {
  return SELF.fetch(`http://localhost/api/episodes/${id}/review-cards`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cards }),
  });
}

interface CardView extends ReviewCard {
  current: { text: string } | null;
  before: string[];
  after: string[];
  reopened: boolean;
}

async function openCards(id: string): Promise<CardView[]> {
  const response = await SELF.fetch(`http://localhost/api/episodes/${id}/review-cards`);
  return ((await response.json()) as { cards: CardView[] }).cards;
}

function resolve(id: string, cardId: string, body: unknown) {
  return SELF.fetch(`http://localhost/api/episodes/${id}/review-cards/${cardId}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function pendingIds(): Promise<string[]> {
  const response = await SELF.fetch("http://localhost/api/review-cards/pending");
  const body = (await response.json()) as { episodes: Array<{ episodeId: string }> };
  return body.episodes.map((e) => e.episodeId);
}

async function retake(id: string, storageKey: string, lines: string[]) {
  const metaKey = `episodes/${storageKey}/meta.json`;
  const meta = JSON.parse(await (await env.R2_BUCKET.get(metaKey))!.text());
  meta.transcribeStatus = "transcribing";
  meta.audioUrl = `https://example.com/episodes/${storageKey}/audio.mp3`;
  await env.R2_BUCKET.put(metaKey, JSON.stringify(meta));

  await putRawLines(storageKey, lines);
  await SELF.fetch(`http://localhost/api/episodes/${id}/transcription-complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcribeStatus: "completed", duration: 300 }),
  });
}

const LINES = [
  "ファームウェアのコードを書き直しました。",
  "スリープ中でも勝手に起きるんですよ。",
  "わー、コードだな。",
];

const CARD = {
  start: 20,
  end: 25,
  line: "わー、コードだな。",
  reason: "「高度だな」の同音かもしれない",
  candidates: ["わー、高度だな。"],
  source: "suspicion",
};

describe("確認カード", () => {
  it("届いたカードを、いまの本文と前後の行を添えて返す", async () => {
    const { id, storageKey } = await createEpisode("Cards List");
    await putRawLines(storageKey, LINES);

    const put = await putCards(id, [CARD]);
    expect(await put.json()).toMatchObject({ received: 1, open: 1 });

    const [card] = await openCards(id);
    expect(card).toMatchObject({
      line: "わー、コードだな。",
      candidates: ["わー、高度だな。"],
      current: { text: "わー、コードだな。" },
      before: [LINES[0], LINES[1]],
      reopened: false,
    });
    expect(await pendingIds()).toContain(id);
  });

  it("「そのままで正しい」と決めると閉じ、機械が同じことをもう一度聞いてきても開かない", async () => {
    const { id, storageKey } = await createEpisode("Cards Keep");
    await putRawLines(storageKey, LINES);
    await putCards(id, [CARD]);
    const [card] = await openCards(id);

    const response = await resolve(id, card.id, { action: "keep", expected: card.current?.text });
    expect(await response.json()).toMatchObject({ action: "keep", open: 0 });
    expect(await openCards(id)).toEqual([]);
    expect(await pendingIds()).not.toContain(id);

    // 校正をもう一度回すと、機械は同じ行をまた挙げてくる
    const again = await putCards(id, [CARD]);
    expect(await again.json()).toMatchObject({ open: 0 });
  });

  it("直すと決めた行だけが変わり、同じ語のある別の行は変わらない", async () => {
    const { id, storageKey } = await createEpisode("Cards Fix");
    await putRawLines(storageKey, LINES);
    await putCards(id, [CARD]);
    const [card] = await openCards(id);

    const response = await resolve(id, card.id, {
      action: "fix",
      text: "わー、高度だな。",
      expected: card.current?.text,
    });
    expect(response.status).toBe(200);

    expect(await publishedLines(storageKey)).toEqual([
      "ファームウェアのコードを書き直しました。",
      "スリープ中でも勝手に起きるんですよ。",
      "わー、高度だな。",
    ]);

    const episode = (await (await SELF.fetch(`http://localhost/api/episodes/${id}`)).json()) as {
      transcriptCorrections: Array<{ source?: string; anchor?: { start: number } }>;
    };
    expect(episode.transcriptCorrections).toMatchObject([{ source: "human", anchor: { start: 20 } }]);
    expect(await openCards(id)).toEqual([]);
  });

  it("画面を開いてから本文が変わっていたら、直さずに知らせる", async () => {
    const { id, storageKey } = await createEpisode("Cards Conflict");
    await putRawLines(storageKey, LINES);
    await putCards(id, [CARD]);
    const [card] = await openCards(id);

    const response = await resolve(id, card.id, {
      action: "fix",
      text: "わー、高度だな。",
      expected: "別の本文",
    });

    expect(response.status).toBe(409);

    // 何も登録されず、カードも開いたまま
    const episode = (await (await SELF.fetch(`http://localhost/api/episodes/${id}`)).json()) as {
      transcriptCorrections?: unknown[] | null;
    };
    expect(episode.transcriptCorrections ?? []).toEqual([]);
    expect(await openCards(id)).toHaveLength(1);
  });

  it("まだ決めていない機械のカードは、届いたもので入れ替える", async () => {
    const { id, storageKey } = await createEpisode("Cards Replace");
    await putRawLines(storageKey, LINES);
    await putCards(id, [CARD]);

    await putCards(id, [{ ...CARD, start: 10, end: 15, line: LINES[1], candidates: [] }]);

    expect((await openCards(id)).map((c) => c.line)).toEqual([LINES[1]]);
  });

  it("取り直しで直した箇所の本文が変わったら、前の判断を添えてカードが戻る", async () => {
    const { id, storageKey } = await createEpisode("Cards Retake Reopen");
    await putRawLines(storageKey, LINES);
    await putCards(id, [CARD]);
    const [card] = await openCards(id);
    await resolve(id, card.id, { action: "fix", text: "わー、高度だな。" });
    expect(await pendingIds()).not.toContain(id);

    // 取り直し。Whisper が今度は別の聞き間違いをした
    await retake(id, storageKey, [LINES[0], LINES[1], "わー、硬度だな。"]);

    // 人の直しは、本文が変わったので修正規則としては失効している
    expect((await publishedLines(storageKey))[2]).toBe("わー、硬度だな。");

    // が、確認した文面はカードに残っていて、確認待ちに戻る
    expect(await pendingIds()).toContain(id);
    const [back] = await openCards(id);
    expect(back).toMatchObject({
      reopened: true,
      resolution: { action: "fix", text: "わー、高度だな。" },
      current: { text: "わー、硬度だな。" },
      // 前に確認した文面が候補になる
      candidates: ["わー、高度だな。"],
    });

    // 前の判断をそのまま入れ直せる
    await resolve(id, back.id, { action: "fix", text: "わー、高度だな。" });
    expect((await publishedLines(storageKey))[2]).toBe("わー、高度だな。");
    expect(await openCards(id)).toEqual([]);
  });

  it("取り直しても確認した文面のままなら、カードは戻らない", async () => {
    const { id, storageKey } = await createEpisode("Cards Retake Holds");
    await putRawLines(storageKey, LINES);
    await putCards(id, [CARD]);
    const [card] = await openCards(id);
    await resolve(id, card.id, { action: "fix", text: "わー、高度だな。" });

    // 今度は Whisper が最初から正しく聞き取った
    await retake(id, storageKey, [LINES[0], LINES[1], "わー、高度だな。"]);

    expect(await openCards(id)).toEqual([]);
    expect(await pendingIds()).not.toContain(id);
  });

  it("押し間違えた判断を取り消すと、入れた修正も外れてカードが開き直る", async () => {
    const { id, storageKey } = await createEpisode("Cards Undo");
    await putRawLines(storageKey, LINES);
    await putCards(id, [CARD]);
    const [card] = await openCards(id);
    await resolve(id, card.id, { action: "fix", text: "わー、高度だな。" });
    expect((await publishedLines(storageKey))[2]).toBe("わー、高度だな。");

    const response = await SELF.fetch(
      `http://localhost/api/episodes/${id}/review-cards/${card.id}/resolution`,
      { method: "DELETE" }
    );

    expect(await response.json()).toMatchObject({ removed: 1 });
    expect((await publishedLines(storageKey))[2]).toBe("わー、コードだな。");
    expect(await openCards(id)).toMatchObject([{ id: card.id, reopened: false }]);
    expect(await pendingIds()).toContain(id);
  });

  it("存在しない回とカードは 404", async () => {
    expect((await putCards("nope", [CARD])).status).toBe(404);

    const { id, storageKey } = await createEpisode("Cards Missing");
    await putRawLines(storageKey, LINES);
    expect((await resolve(id, "nope", { action: "keep" })).status).toBe(404);
  });
});

describe("確認カードのロジック", () => {
  it("行の直しを、行の中でちょうど 1 箇所に決まる形にする", () => {
    // `悲劇 → 喜劇` では行の中の両方が変わる
    const before = "リアクションで悲劇か悲劇かが定まる。";
    const span = pinnedSpan(before, "リアクションで喜劇か悲劇かが定まる。");

    expect(before.split(span!.from).length - 1).toBe(1);
    expect(before.replace(span!.from, span!.to)).toBe("リアクションで喜劇か悲劇かが定まる。");
  });

  it("消すだけの直しでも、空でない from と to になる", () => {
    const before = "違う生き物のはい。目線みたいな感じ。";
    const span = pinnedSpan(before, "違う生き物の目線みたいな感じ。");

    expect(span!.from).not.toBe("");
    expect(span!.to).not.toBe("");
    expect(before.replace(span!.from, span!.to)).toBe("違う生き物の目線みたいな感じ。");
  });

  it("変わっていなければ直しにしない", () => {
    expect(pinnedSpan("同じ。", "同じ。")).toBeNull();
  });

  it("確認した 1 行が 2 行に割れていても、確認は有効", () => {
    // 整形の設定を変えると行の区切りが動く
    const card = {
      id: "a",
      start: 0,
      end: 10,
      line: "",
      reason: "",
      candidates: [],
      source: "suspicion" as const,
      createdAt: "",
      resolution: { action: "fix" as const, text: "わー、高度だな。そうなんですよ。", at: "" },
    };

    expect(
      verificationHolds(card, [
        { start: 0, end: 4, text: "わー、高度だな。" },
        { start: 4, end: 10, text: "そうなんですよ。" },
      ])
    ).toBe(true);
  });

  it("人が決めたカードは、届いたもので入れ替えない", () => {
    const decided: ReviewCard = {
      id: "a",
      start: 0,
      end: 5,
      line: "わー、コードだな。",
      reason: "",
      candidates: [],
      source: "suspicion",
      createdAt: "",
      resolution: { action: "fix", text: "わー、高度だな。", at: "" },
    };

    const merged = mergeIncomingCards(
      [decided, { ...decided, id: "b", start: 50, end: 55, resolution: undefined }],
      [{ start: 100, end: 105, line: "新しい問い。", reason: "", candidates: [], source: "suspicion" }],
      "now",
      () => "new"
    );

    expect(merged.map((c) => c.id)).toEqual(["a", "new"]);
  });
});
