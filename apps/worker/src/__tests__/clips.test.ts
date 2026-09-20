import { describe, it, expect, beforeAll } from "vitest";
import { SELF } from "cloudflare:test";

/**
 * 切り抜き動画の API。
 *
 * 描画はここではできない。手元が下書きを置き、管理画面がそれを直して OK を出し、
 * 手元が拾って描き、版を登録しにくる。その往復が壊れていないかを見る。
 *
 * テストごとにストレージが巻き戻るので、各テストは自分で書き込みから始める。
 * beforeAll で作ったエピソードだけは全テストから見える。
 */
describe("Clips API", () => {
  let episodeId: string;

  beforeAll(async () => {
    const res = await SELF.fetch("http://localhost/api/episodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `切り抜きテスト ${Date.now()}`,
        skipTranscription: true,
      }),
    });
    expect(res.status).toBe(201);
    episodeId = (await res.json()).id;
  });

  const send = (method: string, path: string, body?: unknown) =>
    SELF.fetch(`http://localhost/api/episodes/${episodeId}/clips${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const sub = (id: string, start: number, of: string, extra: Record<string, unknown> = {}) => ({
    id,
    speaker: "あずま",
    start,
    end: start + 2,
    of,
    chars: [...of].map((_, i) => start + i * 0.1),
    rows: [of],
    skip: false,
    ...extra,
  });

  // 離れた 2 か所を、元の音声とは逆の順に繋ぐ。並べ替えて繋げるのが切り抜きの本体
  const draftBody = () => ({
    gap: 0.12,
    edgeFade: 0.03,
    lead: 0.18,
    trail: 0.22,
    audio: { format: "mp3-cbr", headerBytes: 160, bitrate: 192000, sampleRate: 44100, skipSamples: 0 },
    pool: [{ start: 629, end: 727 }],
    spans: [
      { id: "p2", group: "g2", start: 650.8, end: 653.2, gap: 0.3, note: "落ち" },
      { id: "p1", group: "g1", start: 644.8, end: 650.2, gap: null },
    ],
    subs: [sub("s1", 645, "え、ちなみに"), sub("s2", 648, "切層もない"), sub("s3", 651, "𠮷野家で")],
    cards: [{ at: 650, word: "吉野家", image: "https://example.com/y.png" }],
  });

  const placeDraft = (clipId = "c1", draft: unknown = draftBody()) =>
    send("PUT", `/${clipId}`, { label: "脳が5つにちぎれる", draft });

  const getDraft = async (clipId = "c1") => (await send("GET", `/${clipId}/draft`)).json();

  const approve = (clipId = "c1", extra: Record<string, unknown> = {}) =>
    send("PUT", `/${clipId}/status`, { status: "approved", ...extra });

  const myPending = async () => {
    const res = await SELF.fetch("http://localhost/api/clips/pending");
    expect(res.status).toBe(200);
    const { pending } = await res.json();
    return pending.filter((p: { episodeId: string }) => p.episodeId === episodeId);
  };

  describe("下書きを置く（生成側）", () => {
    it("初めて置くと切り抜きができ、一覧に出る", async () => {
      const res = await placeDraft();
      expect(res.status).toBe(200);
      const clip = await res.json();
      expect(clip.status).toBe("draft");
      expect(clip.latest).toBe(0);
      expect(clip.revision).toBe(1);
      expect(clip.posts.youtube.layout).toBe("portrait");

      const { clips } = await (await send("GET", "")).json();
      expect(clips.map((c: { id: string }) => c.id)).toContain("c1");

      const draft = await getDraft();
      expect(draft.revision).toBe(1);
      expect(draft.subs).toHaveLength(3);
      // 生成側が速さを言わなければ 1.2 倍。ショート動画はそのくらいが見やすい
      expect(draft.speed).toBe(1.2);
    });

    it("置き直しても、画面で決めた速さは保つ", async () => {
      await placeDraft();
      const draft = await getDraft();
      await send("PUT", "/c1/draft", { ...draft, speed: 1 });

      await placeDraft();
      expect((await getDraft()).speed).toBe(1);
    });

    it("置き直すと revision が進み、OK は取り消される", async () => {
      await placeDraft();
      await approve();

      const clip = await (await placeDraft()).json();
      expect(clip.revision).toBe(2);
      expect(clip.status).toBe("draft");
      expect(clip.approvedRevision).toBeNull();
      expect(await myPending()).toHaveLength(0);
    });

    it("chars の数が of の字数と合わなければ受け取らない", async () => {
      const draft = draftBody();
      draft.subs[0].chars.pop();
      const res = await placeDraft("c1", draft);
      expect(res.status).toBe(400);
    });

    it("字数はコードポイントで数える（サロゲートを 2 字にしない）", async () => {
      // 「𠮷」は length では 2。生成側（Python）は 1 と数える
      const res = await placeDraft();
      expect(res.status).toBe(200);
    });

    it("区間が pool の外なら受け取らない", async () => {
      const draft = draftBody();
      draft.spans[1].start = 600;
      expect((await placeDraft("c1", draft)).status).toBe(400);
    });

    it("鳴らす区間どうしが重なっていたら受け取らない", async () => {
      const draft = draftBody();
      draft.spans[1].end = 651;
      expect((await placeDraft("c1", draft)).status).toBe(400);
    });

    it("元の音声と違う順に並べた区間を、そのままの順で持つ", async () => {
      await placeDraft();
      const draft = await getDraft();
      expect(draft.spans.map((sp: { id: string }) => sp.id)).toEqual(["p2", "p1"]);
    });
  });

  describe("下書きを直す（管理画面）", () => {
    it("文字・改行・区間の端・skip を直せる", async () => {
      await placeDraft();
      const draft = await getDraft();
      draft.subs[1].rows = ["節操も", "ない"];
      draft.subs[0].skip = true;
      draft.spans[1].start = 644.5;
      draft.spans[0].gap = 0.5;

      const res = await send("PUT", "/c1/draft", draft);
      expect(res.status).toBe(200);
      const saved = await res.json();
      expect(saved.revision).toBe(2);

      const again = await getDraft();
      expect(again.subs[1].rows).toEqual(["節操も", "ない"]);
      // 元の書き起こしの文字は残る。生成側がこれで突き合わせる
      expect(again.subs[1].of).toBe("切層もない");
      expect(again.subs[0].skip).toBe(true);
      expect(again.spans[1].start).toBe(644.5);
      expect(again.spans[0].gap).toBe(0.5);
    });

    it("枚を割っても、of を連ねたものが同じなら通る", async () => {
      await placeDraft();
      const draft = await getDraft();
      const [a] = draft.subs;
      draft.subs.splice(
        0,
        1,
        { ...a, id: "s1a", of: "え、", chars: a.chars.slice(0, 2), rows: ["え、"], end: a.chars[2] },
        { ...a, id: "s1b", of: "ちなみに", chars: a.chars.slice(2), rows: ["ちなみに"], start: a.chars[2] }
      );
      expect((await send("PUT", "/c1/draft", draft)).status).toBe(200);
    });

    it("元に無い字幕は of を空にして足せる", async () => {
      await placeDraft();
      const draft = await getDraft();
      draft.subs.splice(1, 0, {
        id: "n1", speaker: "鉄塔", start: 647.2, end: 647.9, of: "", chars: [], rows: ["（笑）"], skip: false,
      });
      expect((await send("PUT", "/c1/draft", draft)).status).toBe(200);
    });

    it("of を書き換えた保存は弾く", async () => {
      await placeDraft();
      const draft = await getDraft();
      draft.subs[1].of = "節操もない";
      const res = await send("PUT", "/c1/draft", draft);
      expect(res.status).toBe(400);
      expect((await getDraft()).revision).toBe(1);
    });

    it("古い revision からの保存は弾く", async () => {
      await placeDraft();
      const draft = await getDraft();
      expect((await send("PUT", "/c1/draft", draft)).status).toBe(200);

      // もう一方の画面は revision 1 を見たまま
      const res = await send("PUT", "/c1/draft", draft);
      expect(res.status).toBe(409);
      expect((await res.json()).revision).toBe(2);
    });

    it("速さを変えられる。範囲の外は受け取らない", async () => {
      await placeDraft();
      const draft = await getDraft();
      const saved = await (await send("PUT", "/c1/draft", { ...draft, speed: 1.5 })).json();
      expect(saved.speed).toBe(1.5);
      expect((await send("PUT", "/c1/draft", { ...saved, speed: 3 })).status).toBe(400);
    });

    it("区間の端を pool の外へは動かせない", async () => {
      await placeDraft();
      const draft = await getDraft();
      draft.spans[0].end = 800;
      expect((await send("PUT", "/c1/draft", draft)).status).toBe(400);
    });

    it("区間を外せる。全部外すことはできない", async () => {
      await placeDraft();
      const draft = await getDraft();
      draft.spans[0].off = true;
      const saved = await (await send("PUT", "/c1/draft", draft)).json();
      expect(saved.spans[0].off).toBe(true);

      saved.spans[1].off = true;
      expect((await send("PUT", "/c1/draft", saved)).status).toBe(400);
    });

    it("pool と audio は管理画面からは変えられない", async () => {
      await placeDraft();
      const draft = await getDraft();
      const wider = { ...draft, pool: [{ start: 0, end: 3000 }] };
      expect((await send("PUT", "/c1/draft", wider)).status).toBe(400);
    });

    it("OK を出したあとは直せない。取り消せば直せる", async () => {
      await placeDraft();
      await approve();
      const draft = await getDraft();
      expect((await send("PUT", "/c1/draft", draft)).status).toBe(409);

      await send("PUT", "/c1/status", { status: "draft" });
      expect((await send("PUT", "/c1/draft", draft)).status).toBe(200);
    });
  });

  describe("OK から描画まで", () => {
    it("OK に投稿の予定を添えられ、手元から拾える", async () => {
      await placeDraft();
      const res = await approve("c1", {
        publishAt: "2026-09-27T21:00:00+09:00",
        postText: "切り抜きです",
        posts: { instagram: { enabled: false }, x: { layout: "square" } },
      });
      expect(res.status).toBe(200);
      const clip = await res.json();
      expect(clip.status).toBe("approved");
      expect(clip.approvedRevision).toBe(1);
      expect(clip.publishAt).toBe("2026-09-27T12:00:00.000Z");
      expect(clip.posts.instagram.enabled).toBe(false);
      expect(clip.posts.x.layout).toBe("square");

      const pending = await myPending();
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({ clipId: "c1", revision: 1 });
    });

    it("一度巡回して索引ができたあとに出した OK も拾える", async () => {
      await placeDraft();
      expect(await myPending()).toHaveLength(0);
      await approve();
      expect(await myPending()).toHaveLength(1);
    });

    it("OK を取り消すと拾われなくなる", async () => {
      await placeDraft();
      await approve();
      await myPending();
      await send("PUT", "/c1/status", { status: "draft" });
      expect(await myPending()).toHaveLength(0);
    });

    it("動画の置き場をレイアウトごとに Presigned URL で渡す", async () => {
      await placeDraft();
      const res = await send("POST", "/c1/upload-url", { layout: "square" });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.n).toBe(1);
      expect(json.key).toContain("/clips/c1/v1/square.mp4");
      expect(json.uploadUrl).toContain("X-Amz-Signature");

      expect((await send("POST", "/c1/upload-url", { layout: "wide" })).status).toBe(400);
    });

    it("版を登録すると rendered になり、拾われなくなる", async () => {
      await placeDraft();
      await approve();
      await myPending();

      const res = await send("POST", "/c1/versions", {
        revision: 1,
        layouts: ["portrait", "landscape", "square"],
      });
      expect(res.status).toBe(201);
      const clip = await res.json();
      expect(clip.status).toBe("rendered");
      expect(clip.latest).toBe(1);
      expect(clip.versions[0]).toMatchObject({ n: 1, revision: 1 });
      expect(await myPending()).toHaveLength(0);
    });

    it("OK と違う revision を描いた版は受け取らない", async () => {
      await placeDraft();
      await approve();
      const res = await send("POST", "/c1/versions", { revision: 7, layouts: ["portrait"] });
      expect(res.status).toBe(409);
    });

    it("OK が出ていないものの版は受け取らない", async () => {
      await placeDraft();
      const res = await send("POST", "/c1/versions", { revision: 1, layouts: ["portrait"] });
      expect(res.status).toBe(409);
    });

    it("投稿に使うレイアウトが欠けた版は受け取らない", async () => {
      await placeDraft();
      await approve("c1", { publishAt: "2026-09-27T12:00:00Z" });
      const res = await send("POST", "/c1/versions", { revision: 1, layouts: ["portrait"] });
      expect(res.status).toBe(400);
    });

    it("描き直すと、前の版を残して積む", async () => {
      await placeDraft();
      await approve();
      await send("POST", "/c1/versions", { revision: 1, layouts: ["portrait"] });

      await send("PUT", "/c1/status", { status: "draft" });
      const draft = await getDraft();
      draft.subs[1].rows = ["節操もない"];
      await send("PUT", "/c1/draft", draft);
      await approve();

      const clip = await (
        await send("POST", "/c1/versions", { revision: 2, layouts: ["portrait"] })
      ).json();
      expect(clip.latest).toBe(2);
      expect(clip.versions.map((v: { revision: number }) => v.revision)).toEqual([1, 2]);
    });
  });

  describe("OK / ボツ", () => {
    it("状態を変えると一覧にも反映される", async () => {
      await placeDraft();
      await send("PUT", "/c1/status", { status: "rejected" });
      const { clips } = await (await send("GET", "")).json();
      expect(clips.find((c: { id: string }) => c.id === "c1").status).toBe("rejected");
    });

    it("知らない状態は受け取らない。rendered や published は外から付けられない", async () => {
      await placeDraft();
      expect((await send("PUT", "/c1/status", { status: "done" })).status).toBe(400);
      expect((await send("PUT", "/c1/status", { status: "published" })).status).toBe(400);
    });

    it("読めない投稿日時は受け取らない", async () => {
      await placeDraft();
      expect((await approve("c1", { publishAt: "来週" })).status).toBe(400);
    });
  });

  describe("見つからないとき", () => {
    it("知らないエピソードは 404", async () => {
      const res = await SELF.fetch("http://localhost/api/episodes/no-such-episode/clips");
      expect(res.status).toBe(404);
    });

    it("知らない切り抜きは 404", async () => {
      expect((await send("GET", "/nope")).status).toBe(404);
      expect((await send("GET", "/nope/draft")).status).toBe(404);
      expect((await send("PUT", "/nope/status", { status: "approved" })).status).toBe(404);
    });
  });
});
