import { describe, it, expect } from "vitest";
import { getRawTranscript } from "../services/transcript-postprocess";
import type { Env, TranscriptData } from "../types";

/**
 * R2 バケットの差し替え
 *
 * この関数は「読んだ内容を別のキーに複製する」ため、テストランナーの分離ストレージと
 * 相性が悪い（フレームの後始末に失敗する）。検証したいのはキーの選び方と複製の有無
 * だけなので、バケットを差し替えて実際の R2 は触らない。
 */
function createBucket(objects: Record<string, string>) {
  const puts: Record<string, string> = {};

  const bucket = {
    async get(key: string) {
      const value = objects[key];
      return value === undefined ? null : { text: async () => value };
    },
    async put(key: string, value: string) {
      puts[key] = value;
      objects[key] = value;
    },
  };

  return { bucket, puts };
}

function envWith(objects: Record<string, string>) {
  const { bucket, puts } = createBucket(objects);
  return { env: { R2_BUCKET: bucket } as unknown as Env, puts };
}

function transcript(text: string): string {
  const data: TranscriptData = {
    language: "ja",
    segments: [{ start: 0, end: 1, text }],
  };
  return JSON.stringify(data);
}

describe("getRawTranscript", () => {
  it("生データがあればそれを返す", async () => {
    const { env } = envWith({
      "episodes/key/transcript.raw.json": transcript("生"),
      "episodes/key/transcript.json": transcript("処理済み"),
    });

    const raw = await getRawTranscript(env, "key");

    expect(raw?.segments[0].text).toBe("生");
  });

  it("話者分離の導入前のエピソードは transcript.json を生データとして複製する", async () => {
    // 複製しておかないと、次回は後処理済みの transcript.json を入力にしてしまい
    // 統合や置換が二重にかかる
    const { env, puts } = envWith({
      "episodes/legacy/transcript.json": transcript("むかしの文字起こし"),
    });

    const raw = await getRawTranscript(env, "legacy");

    expect(raw?.segments[0].text).toBe("むかしの文字起こし");
    expect(puts["episodes/legacy/transcript.raw.json"]).toBeDefined();
  });

  it("複製したあとは生データのほうを読む", async () => {
    const objects: Record<string, string> = {
      "episodes/legacy/transcript.json": transcript("元データ"),
    };
    const { env } = envWith(objects);

    await getRawTranscript(env, "legacy");

    // 1 回目の複製後に後処理済みで上書きされても、2 回目は複製した生データを読む
    objects["episodes/legacy/transcript.json"] = transcript("後処理済み");
    const second = await getRawTranscript(env, "legacy");

    expect(second?.segments[0].text).toBe("元データ");
  });

  it("どちらも無ければ null を返す", async () => {
    const { env } = envWith({});

    expect(await getRawTranscript(env, "missing")).toBeNull();
  });
});
