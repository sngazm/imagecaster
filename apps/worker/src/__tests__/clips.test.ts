import { describe, it, expect, beforeAll } from "vitest";
import { SELF } from "cloudflare:test";

/**
 * 切り抜き動画の API。
 *
 * 描画はここではできないので、管理画面は指示を預かるだけ。作り直しは手元の
 * 道具が引き取り、出来たら版を積みにくる。その往復が壊れていないかを見る。
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

  const putVersion = (clipId: string, body: Record<string, unknown> = {}) =>
    SELF.fetch(`http://localhost/api/episodes/${episodeId}/clips/${clipId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const getClips = () =>
    SELF.fetch(`http://localhost/api/episodes/${episodeId}/clips`);

  const myPending = async () => {
    const res = await SELF.fetch("http://localhost/api/clips/pending");
    expect(res.status).toBe(200);
    const { pending } = await res.json();
    return pending.filter((p: { episodeId: string }) => p.episodeId === episodeId);
  };

  describe("版を積む", () => {
    it("初めての PUT で v1 ができ、一覧に出る", async () => {
      const res = await putVersion("c1", {
        label: "脳が5つにちぎれる",
        range: ["10:49", "11:47"],
        clip: { start: 644, duration: 68 },
      });

      expect(res.status).toBe(200);
      const clip = await res.json();
      expect(clip.latest).toBe(1);
      expect(clip.status).toBe("draft");
      expect(clip.label).toBe("脳が5つにちぎれる");

      const { clips } = await (await getClips()).json();
      expect(clips.map((c: { id: string }) => c.id)).toContain("c1");
    });

    it("もう一度 PUT すると、上書きせずに積む", async () => {
      await putVersion("c1", { label: "テスト" });
      const clip = await (await putVersion("c1")).json();

      expect(clip.latest).toBe(2);
      expect(clip.versions).toHaveLength(2);
      // 前の版が消えていないこと。悪くなったときに戻れる必要がある
      expect(clip.versions[0].n).toBe(1);
    });
  });

  describe("直しの指示", () => {
    const postRequest = (items: unknown[], baseVersion?: number) =>
      SELF.fetch(
        `http://localhost/api/episodes/${episodeId}/clips/c1/requests`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ baseVersion, items }),
        }
      );

    it("預かる。字幕はここでは書き換えない", async () => {
      await putVersion("c1", { label: "テスト" });

      const res = await postRequest(
        [
          { type: "note", index: 3, text: "区切りを前に寄せて" },
          { type: "delete", index: 7 },
        ],
        1
      );

      expect(res.status).toBe(201);
      const request = await res.json();
      expect(request.appliedIn).toBeNull();
      expect(request.baseVersion).toBe(1);
      expect(request.items).toHaveLength(2);
    });

    it("空の指示は受け取らない", async () => {
      await putVersion("c1", { label: "テスト" });
      expect((await postRequest([])).status).toBe(400);
    });

    it("未処理のあいだは手元から拾える", async () => {
      await putVersion("c1", { label: "テスト" });
      await postRequest([{ type: "delete", index: 1 }]);

      const mine = await myPending();
      expect(mine).toHaveLength(1);
      expect(mine[0].clipId).toBe("c1");
      expect(mine[0].requestId).toBe("r1");
    });

    it("一度巡回して索引ができたあとに預けた指示も拾える", async () => {
      await putVersion("c1", { label: "テスト" });

      // 1 時間おきに叩かれるので、巡回では全件走査しない。索引はこの 1 回目で
      // 作られ、以降はそれしか読まない。つまり預けるたびに索引を更新しないと、
      // 指示は永久に拾われないまま溜まる。いちばん原因を追いにくい壊れ方
      expect(await myPending()).toHaveLength(0);

      await postRequest([{ type: "delete", index: 1 }]);

      const mine = await myPending();
      expect(mine).toHaveLength(1);
      expect(mine[0].requestId).toBe("r1");

      await putVersion("c1", { appliedRequest: "r1" });
      expect(await myPending()).toHaveLength(0);
    });

    it("反映した版を積むと、拾われなくなる", async () => {
      await putVersion("c1", { label: "テスト" });
      await postRequest([{ type: "delete", index: 1 }]);

      const clip = await (await putVersion("c1", { appliedRequest: "r1" })).json();
      expect(clip.latest).toBe(2);
      expect(
        clip.requests.find((r: { id: string }) => r.id === "r1").appliedIn
      ).toBe(2);

      // 印を付け忘れると手元が何度も拾ってしまう
      expect(await myPending()).toHaveLength(0);
    });
  });

  describe("OK / ボツ", () => {
    const setStatus = (status: string) =>
      SELF.fetch(
        `http://localhost/api/episodes/${episodeId}/clips/c1/status`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        }
      );

    it("状態を変えると一覧にも反映される", async () => {
      await putVersion("c1", { label: "テスト" });

      const res = await setStatus("approved");
      expect(res.status).toBe(200);
      expect((await res.json()).status).toBe("approved");

      const { clips } = await (await getClips()).json();
      const entry = clips.find((c: { id: string }) => c.id === "c1");
      expect(entry.status).toBe("approved");
      expect(entry.latest).toBe(1);
    });

    it("作り直した版が来たら OK は取り消される", async () => {
      await putVersion("c1", { label: "テスト" });
      await setStatus("approved");

      // OK はその版に対して出したもの。作り直したら見直しからやり直す
      const clip = await (await putVersion("c1")).json();
      expect(clip.latest).toBe(2);
      expect(clip.status).toBe("draft");
    });

    it("知らない状態は受け取らない", async () => {
      await putVersion("c1", { label: "テスト" });
      expect((await setStatus("とりあえず保留")).status).toBe(400);
    });
  });

  describe("版の中身", () => {
    const subs = (text: string) => [
      { index: 0, speaker: "あずま", start: 0, end: 1.5, rows: [text] },
    ];

    it("動画の置き場を Presigned URL で渡す", async () => {
      await putVersion("c1", { label: "テスト" });

      const res = await SELF.fetch(
        `http://localhost/api/episodes/${episodeId}/clips/c1/upload-url`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      // 版を指定しなければ次の版。そのまま PUT すれば番号が揃う
      expect(json.n).toBe(2);
      expect(json.key).toContain("/clips/c1/v2/clip.mp4");
      expect(json.uploadUrl).toContain("X-Amz-Signature");
    });

    it("字幕を一緒に置くと、その版の字幕として読める", async () => {
      await putVersion("c1", { label: "テスト", subs: subs("え、ちなみに") });

      const res = await SELF.fetch(
        `http://localhost/api/episodes/${episodeId}/clips/c1/versions/1/subs`
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(subs("え、ちなみに"));
    });

    it("版ごとに別の字幕が残る", async () => {
      await putVersion("c1", { subs: subs("まえの版") });
      await putVersion("c1", { subs: subs("あとの版") });

      const read = async (n: number) =>
        (
          await (
            await SELF.fetch(
              `http://localhost/api/episodes/${episodeId}/clips/c1/versions/${n}/subs`
            )
          ).json()
        )[0].rows[0];

      // 見比べるために積んでいる。前の版が上書きされたら意味がない
      expect(await read(1)).toBe("まえの版");
      expect(await read(2)).toBe("あとの版");
    });
  });

  describe("見つからないとき", () => {
    it("知らないエピソードは 404", async () => {
      const res = await SELF.fetch(
        "http://localhost/api/episodes/no-such-episode/clips"
      );
      expect(res.status).toBe(404);
    });

    it("知らない切り抜きは 404", async () => {
      const res = await SELF.fetch(
        `http://localhost/api/episodes/${episodeId}/clips/no-such-clip`
      );
      expect(res.status).toBe(404);
    });

    it("字幕がまだ無い版は 404", async () => {
      const res = await SELF.fetch(
        `http://localhost/api/episodes/${episodeId}/clips/c1/versions/1/subs`
      );
      expect(res.status).toBe(404);
    });
  });
});
