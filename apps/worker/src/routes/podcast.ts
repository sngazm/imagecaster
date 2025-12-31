import { Hono } from "hono";
import type { Env } from "../types";
import { deleteAllData } from "../services/r2";

export const podcast = new Hono<{ Bindings: Env }>();

/**
 * DELETE /api/podcast/reset - 全データを削除
 *
 * R2バケット内の全データ（エピソード、設定、テンプレート、フィードなど）を削除します。
 * この操作は取り消せません。
 */
podcast.delete("/reset", async (c) => {
  try {
    const result = await deleteAllData(c.env);

    return c.json({
      success: true,
      message: "全データを削除しました",
      deletedCount: result.deletedCount,
    });
  } catch (err) {
    console.error("Failed to delete all data:", err);
    return c.json(
      { error: "Failed to delete all data" },
      500
    );
  }
});
