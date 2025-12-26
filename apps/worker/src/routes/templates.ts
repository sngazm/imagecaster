import { Hono } from "hono";
import type { Env, TemplateRequest } from "../types";
import { getTemplatesIndex, saveTemplatesIndex } from "../services/r2";

export const templates = new Hono<{ Bindings: Env }>();

/**
 * テンプレート一覧を取得
 */
templates.get("/", async (c) => {
  const index = await getTemplatesIndex(c.env);
  return c.json(index.templates);
});

/**
 * テンプレートを作成
 */
templates.post("/", async (c) => {
  const body = await c.req.json<TemplateRequest>();

  if (!body.name || !body.content) {
    return c.json({ error: "Name and content are required" }, 400);
  }

  const index = await getTemplatesIndex(c.env);

  // ユニークなIDを生成
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
  await saveTemplatesIndex(c.env, index);

  return c.json(newTemplate, 201);
});

/**
 * テンプレートを取得
 */
templates.get("/:id", async (c) => {
  const id = c.req.param("id");
  const index = await getTemplatesIndex(c.env);

  const template = index.templates.find((t) => t.id === id);
  if (!template) {
    return c.json({ error: "Template not found" }, 404);
  }

  return c.json(template);
});

/**
 * テンプレートを更新
 */
templates.put("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<TemplateRequest>();

  const index = await getTemplatesIndex(c.env);
  const templateIndex = index.templates.findIndex((t) => t.id === id);

  if (templateIndex === -1) {
    return c.json({ error: "Template not found" }, 404);
  }

  const template = index.templates[templateIndex];

  if (body.name !== undefined) template.name = body.name;
  if (body.content !== undefined) template.content = body.content;
  template.updatedAt = new Date().toISOString();

  await saveTemplatesIndex(c.env, index);

  return c.json(template);
});

/**
 * テンプレートを削除
 */
templates.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const index = await getTemplatesIndex(c.env);

  const templateIndex = index.templates.findIndex((t) => t.id === id);
  if (templateIndex === -1) {
    return c.json({ error: "Template not found" }, 404);
  }

  index.templates.splice(templateIndex, 1);
  await saveTemplatesIndex(c.env, index);

  return c.json({ success: true });
});
