import { postProcess, toPostProcessOptions } from "../services/transcript-postprocess";
import { describe, it, expect } from "vitest";
import { SELF, env } from "cloudflare:test";

describe("Settings API", () => {
  describe("GET /api/settings", () => {
    it("returns podcast settings", async () => {
      const response = await SELF.fetch("http://localhost/api/settings");

      expect(response.status).toBe(200);

      const json = await response.json();
      // 設定オブジェクトの基本的なプロパティを確認
      expect(json).toHaveProperty("title");
      expect(json).toHaveProperty("description");
      expect(json).toHaveProperty("author");
    });
  });

  describe("PUT /api/settings", () => {
    it("updates podcast title", async () => {
      const newTitle = `Test Podcast ${Date.now()}`;

      const response = await SELF.fetch("http://localhost/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle }),
      });

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.title).toBe(newTitle);
    });

    it("updates multiple settings at once", async () => {
      const updates = {
        title: `Updated Podcast ${Date.now()}`,
        description: "Updated description for testing",
        author: "Test Author",
        email: "test@example.com",
        language: "en",
        category: "Technology",
      };

      const response = await SELF.fetch("http://localhost/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.title).toBe(updates.title);
      expect(json.description).toBe(updates.description);
      expect(json.author).toBe(updates.author);
      expect(json.email).toBe(updates.email);
      expect(json.language).toBe(updates.language);
      expect(json.category).toBe(updates.category);
    });

    it("updates explicit flag", async () => {
      const response = await SELF.fetch("http://localhost/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ explicit: true }),
      });

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.explicit).toBe(true);
    });

    it("preserves existing settings when updating partial fields", async () => {
      // 最初に設定を取得
      const getResponse = await SELF.fetch("http://localhost/api/settings");
      const originalSettings = await getResponse.json();

      // titleのみ更新
      const newTitle = `Partial Update ${Date.now()}`;
      await SELF.fetch("http://localhost/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle }),
      });

      // 更新後の設定を取得
      const updatedResponse = await SELF.fetch("http://localhost/api/settings");
      const updatedSettings = await updatedResponse.json();

      expect(updatedSettings.title).toBe(newTitle);
      // 他のフィールドは保持される（明示的にundefinedでない限り）
      expect(updatedSettings.author).toBe(originalSettings.author);
    });

    it("updates analyticsPrefix and reflects in RSS feed", async () => {
      const prefix = "https://op3.dev/e";

      const response = await SELF.fetch("http://localhost/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analyticsPrefix: prefix }),
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.analyticsPrefix).toBe(prefix);

      // feedにプレフィックスが付与されているか確認
      const feedObj = await env.R2_BUCKET.get("feed.xml");
      expect(feedObj).not.toBeNull();
      const feedXml = await feedObj!.text();
      // エピソードがある場合はプレフィックスが付与される
      if (feedXml.includes("<enclosure")) {
        expect(feedXml).toMatch(new RegExp(`url="${prefix}/`));
      }
    });

    it("clears analyticsPrefix when set to empty string", async () => {
      // まずプレフィックスを設定
      await SELF.fetch("http://localhost/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analyticsPrefix: "https://op3.dev/e" }),
      });

      // 空文字で削除
      const response = await SELF.fetch("http://localhost/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analyticsPrefix: "" }),
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      // 空文字はundefinedとして扱われる
      expect(json.analyticsPrefix).toBeUndefined();
    });

    it("regenerates RSS feed after settings update", async () => {
      const newEmail = `feed-test-${Date.now()}@example.com`;

      // 設定を更新（emailを変更）
      const updateResponse = await SELF.fetch(
        "http://localhost/api/settings",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: newEmail }),
        }
      );
      expect(updateResponse.status).toBe(200);

      // R2に保存されたfeed.xmlを取得して更新されたemailが反映されているか確認
      const feedObj = await env.R2_BUCKET.get("feed.xml");
      expect(feedObj).not.toBeNull();

      const feedXml = await feedObj!.text();
      expect(feedXml).toContain(`<itunes:email>${newEmail}</itunes:email>`);
    });
  });

  describe("POST /api/settings/artwork/upload-url", () => {
    it("rejects invalid content type", async () => {
      const response = await SELF.fetch(
        "http://localhost/api/settings/artwork/upload-url",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contentType: "image/gif",
            fileSize: 100000,
          }),
        }
      );

      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toContain("Invalid content type");
    });

    it("rejects file too large", async () => {
      const response = await SELF.fetch(
        "http://localhost/api/settings/artwork/upload-url",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contentType: "image/jpeg",
            fileSize: 10 * 1024 * 1024, // 10MB
          }),
        }
      );

      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toContain("File too large");
    });

    it("accepts valid JPEG request", async () => {
      const response = await SELF.fetch(
        "http://localhost/api/settings/artwork/upload-url",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contentType: "image/jpeg",
            fileSize: 500000,
          }),
        }
      );

      // 開発モードではR2クレデンシャルがないためエラーになる可能性
      expect([200, 500]).toContain(response.status);

      if (response.status === 200) {
        const json = await response.json();
        expect(json.uploadUrl).toBeDefined();
        expect(json.expiresIn).toBe(3600);
        expect(json.artworkUrl).toContain("assets/artwork.jpg");
      }
    });

    it("accepts valid PNG request", async () => {
      const response = await SELF.fetch(
        "http://localhost/api/settings/artwork/upload-url",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contentType: "image/png",
            fileSize: 500000,
          }),
        }
      );

      expect([200, 500]).toContain(response.status);

      if (response.status === 200) {
        const json = await response.json();
        expect(json.artworkUrl).toContain("assets/artwork.png");
      }
    });
  });

  describe("POST /api/settings/artwork/upload-complete", () => {
    it("updates artworkUrl in settings", async () => {
      const artworkUrl = "https://example.com/artwork.jpg";

      const response = await SELF.fetch(
        "http://localhost/api/settings/artwork/upload-complete",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ artworkUrl }),
        }
      );

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.artworkUrl).toBe(artworkUrl);

      // 設定を取得して確認
      const getResponse = await SELF.fetch("http://localhost/api/settings");
      const settings = await getResponse.json();
      expect(settings.artworkUrl).toBe(artworkUrl);
    });
  });
});

describe("文字起こしの後処理設定", () => {
  it("未設定でも既定値を返す", async () => {
    const response = await SELF.fetch("http://localhost/api/settings");
    const json = (await response.json()) as {
      transcriptPostProcess: {
        speakerDefaults: unknown[];
        merge: { enabled: boolean; maxDurationSec: number };
        corrections: unknown[];
        simultaneousUntilSec: number | null;
      };
    };

    expect(json.transcriptPostProcess).toBeDefined();
    expect(json.transcriptPostProcess.merge.enabled).toBe(true);
    expect(json.transcriptPostProcess.speakerDefaults).toEqual([]);
    expect(json.transcriptPostProcess.corrections).toEqual([]);
    // 既定では同時発話を検出しない
    expect(json.transcriptPostProcess.simultaneousUntilSec).toBeNull();
  });

  it("同時発話の検出範囲を保存する", async () => {
    await SELF.fetch("http://localhost/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcriptPostProcess: {
          speakerDefaults: [],
          merge: { enabled: true, maxGapSec: null, maxDurationSec: 10, maxChars: 200 },
          corrections: [],
          simultaneousUntilSec: 30,
        },
      }),
    });

    const response = await SELF.fetch("http://localhost/api/settings");
    const json = (await response.json()) as {
      transcriptPostProcess: { simultaneousUntilSec: number | null };
    };

    expect(json.transcriptPostProcess.simultaneousUntilSec).toBe(30);
  });

  it("0 以下の検出範囲は「検出しない」として保存する", async () => {
    await SELF.fetch("http://localhost/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcriptPostProcess: {
          speakerDefaults: [],
          merge: { enabled: true, maxGapSec: null, maxDurationSec: 10, maxChars: 200 },
          corrections: [],
          simultaneousUntilSec: 0,
        },
      }),
    });

    const response = await SELF.fetch("http://localhost/api/settings");
    const json = (await response.json()) as {
      transcriptPostProcess: { simultaneousUntilSec: number | null };
    };

    expect(json.transcriptPostProcess.simultaneousUntilSec).toBeNull();
  });

  it("話者の既定割り当てと辞書を保存する", async () => {
    const response = await SELF.fetch("http://localhost/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcriptPostProcess: {
          speakerDefaults: [
            { track: 1, label: "あずま" },
            { track: 2, label: "鉄塔" },
            { track: 3, label: "" },
          ],
          merge: { enabled: true, maxGapSec: null, maxDurationSec: 10, maxChars: 200 },
          corrections: [
            { from: "テト", to: "鉄塔", enabled: true, note: "自己紹介の定型" },
          ],
        },
      }),
    });

    expect(response.status).toBe(200);

    const getResponse = await SELF.fetch("http://localhost/api/settings");
    const json = (await getResponse.json()) as {
      transcriptPostProcess: {
        speakerDefaults: Array<{ track: number; label: string | null }>;
        merge: { maxGapSec: number | null };
        corrections: Array<{ from: string; to: string; enabled: boolean; note?: string }>;
      };
    };

    // 空文字のラベルは非発話トラック（null）として保存される
    expect(json.transcriptPostProcess.speakerDefaults).toEqual([
      { track: 1, label: "あずま" },
      { track: 2, label: "鉄塔" },
      { track: 3, label: null },
    ]);
    // null は「間の長さを条件にしない」という意味なので既定値で埋めない
    expect(json.transcriptPostProcess.merge.maxGapSec).toBeNull();
    expect(json.transcriptPostProcess.corrections[0]).toEqual({
      from: "テト",
      to: "鉄塔",
      enabled: true,
      note: "自己紹介の定型",
    });
  });

  it("不正な値は落として保存する", async () => {
    await SELF.fetch("http://localhost/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcriptPostProcess: {
          speakerDefaults: [
            { track: 1, label: "あずま" },
            { track: 0, label: "不正なトラック番号" },
            { track: 1, label: "重複" },
            "文字列",
          ],
          merge: { maxDurationSec: "十秒" },
          corrections: [
            { from: "", to: "空のfromは無効" },
            { from: "有効", to: "置換先" },
          ],
        },
      }),
    });

    const response = await SELF.fetch("http://localhost/api/settings");
    const json = (await response.json()) as {
      transcriptPostProcess: {
        speakerDefaults: Array<{ track: number }>;
        merge: { maxDurationSec: number };
        corrections: Array<{ from: string }>;
      };
    };

    expect(json.transcriptPostProcess.speakerDefaults).toEqual([
      { track: 1, label: "あずま" },
    ]);
    // 数値でない値は既定値に戻す
    expect(json.transcriptPostProcess.merge.maxDurationSec).toBe(10);
    expect(json.transcriptPostProcess.corrections).toEqual([
      { from: "有効", to: "置換先", enabled: true },
    ]);
  });
});

describe("相槌の設定が保存経路を往復すること", () => {
  it("PUT した相槌設定が GET で戻り、後処理にも効く", async () => {
    const saved = await SELF.fetch("http://local.test/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcriptPostProcess: {
          speakerDefaults: [],
          merge: { enabled: false, maxGapSec: null, maxDurationSec: 10, maxChars: 200 },
          corrections: [],
          backchannel: {
            enabled: true,
            units: ["うん"],
            maxRepeat: 3,
            dropStandalone: true,
            standalonePhrases: ["ふむ"],
          },
        },
      }),
    });
    expect(saved.status).toBe(200);

    const read = await SELF.fetch("http://local.test/api/settings");
    const body = (await read.json()) as any;
    const backchannel = body.transcriptPostProcess.backchannel;

    expect(backchannel.dropStandalone).toBe(true);
    expect(backchannel.standalonePhrases).toEqual(["ふむ"]);

    // 既定の「はい」ではなく、保存した「ふむ」だけが落ちる
    const result = postProcess(
      {
        language: "ja",
        segments: [
          { start: 0, end: 1, text: "ふむ。" },
          { start: 1, end: 2, text: "はい。" },
          { start: 2, end: 4, text: "本編です。" },
        ],
      },
      toPostProcessOptions(body.transcriptPostProcess)
    );

    expect(result.segments.map((s) => s.text)).toEqual(["はい。", "本編です。"]);
  });
});
