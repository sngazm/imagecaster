import { Hono } from "hono";
import type { Env, TemplateRequest } from "../types";
import { getTemplatesIndex, saveTemplatesIndex } from "../services/r2";

export const templates = new Hono<{ Bindings: Env }>();

/**
 * GET /api/podcasts/:podcastId/templates - テンプレート一覧を取得
 */
templates.get("/", async (c) => {
  const podcastId = c.req.param("podcastId");
  const index = await getTemplatesIndex(c.env, podcastId);
  return c.json(index.templates);
});

/**
 * POST /api/podcasts/:podcastId/templates - テンプレートを作成
 */
templates.post("/", async (c) => {
  const podcastId = c.req.param("podcastId");
  const body = await c.req.json<TemplateRequest>();

  if (!body.name || !body.content) {
    return c.json({ error: "Name and content are required" }, 400);
  }

  const index = await getTemplatesIndex(c.env, podcastId);

  const id = `tmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  const newTemplate = {
    id,
    name: body.name,
    content: body.content,
    createdAt: now,
    updatedAt: now,
  };

  index.templates.push(newTemplate);
  await saveTemplatesIndex(c.env, podcastId, index);

  return c.json(newTemplate, 201);
});

/**
 * GET /api/podcasts/:podcastId/templates/:id - テンプレートを取得
 */
templates.get("/:id", async (c) => {
  const podcastId = c.req.param("podcastId");
  const id = c.req.param("id");
  const index = await getTemplatesIndex(c.env, podcastId);

  const template = index.templates.find((t) => t.id === id);
  if (!template) {
    return c.json({ error: "Template not found" }, 404);
  }

  return c.json(template);
});

/**
 * PUT /api/podcasts/:podcastId/templates/:id - テンプレートを更新
 */
templates.put("/:id", async (c) => {
  const podcastId = c.req.param("podcastId");
  const id = c.req.param("id");
  const body = await c.req.json<TemplateRequest>();

  const index = await getTemplatesIndex(c.env, podcastId);
  const templateIndex = index.templates.findIndex((t) => t.id === id);

  if (templateIndex === -1) {
    return c.json({ error: "Template not found" }, 404);
  }

  const template = index.templates[templateIndex];

  if (body.name !== undefined) template.name = body.name;
  if (body.content !== undefined) template.content = body.content;
  template.updatedAt = new Date().toISOString();

  await saveTemplatesIndex(c.env, podcastId, index);

  return c.json(template);
});

/**
 * DELETE /api/podcasts/:podcastId/templates/:id - テンプレートを削除
 */
templates.delete("/:id", async (c) => {
  const podcastId = c.req.param("podcastId");
  const id = c.req.param("id");
  const index = await getTemplatesIndex(c.env, podcastId);

  const templateIndex = index.templates.findIndex((t) => t.id === id);
  if (templateIndex === -1) {
    return c.json({ error: "Template not found" }, 404);
  }

  index.templates.splice(templateIndex, 1);
  await saveTemplatesIndex(c.env, podcastId, index);

  return c.json({ success: true });
});
