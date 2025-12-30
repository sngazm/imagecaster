import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";

/**
 * テスト用ヘルパー: テンプレートを作成してIDを返す
 */
async function createTestTemplate(data: {
  name: string;
  content: string;
}): Promise<{ id: string }> {
  const response = await SELF.fetch("http://localhost/api/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const json = await response.json();
  return { id: json.id };
}

describe("Templates API", () => {
  describe("GET /api/templates", () => {
    it("returns template list", async () => {
      const response = await SELF.fetch("http://localhost/api/templates");

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(Array.isArray(json)).toBe(true);
    });
  });

  describe("POST /api/templates", () => {
    it("creates a new template", async () => {
      const templateData = {
        name: `Test Template ${Date.now()}`,
        content: "This is a test template content with {{placeholder}}",
      };

      const response = await SELF.fetch("http://localhost/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(templateData),
      });

      expect(response.status).toBe(201);

      const json = await response.json();
      expect(json.id).toBeDefined();
      expect(json.name).toBe(templateData.name);
      expect(json.content).toBe(templateData.content);
      expect(json.createdAt).toBeDefined();
      expect(json.updatedAt).toBeDefined();
    });

    it("rejects template without name", async () => {
      const response = await SELF.fetch("http://localhost/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "Template without name",
        }),
      });

      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toBe("Name and content are required");
    });

    it("rejects template without content", async () => {
      const response = await SELF.fetch("http://localhost/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Template without content",
        }),
      });

      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toBe("Name and content are required");
    });
  });

  describe("GET /api/templates/:id", () => {
    it("returns template details", async () => {
      const templateData = {
        name: `Detail Template ${Date.now()}`,
        content: "Template content for detail test",
      };
      const { id } = await createTestTemplate(templateData);

      const response = await SELF.fetch(
        `http://localhost/api/templates/${id}`
      );

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.id).toBe(id);
      expect(json.name).toBe(templateData.name);
      expect(json.content).toBe(templateData.content);
    });

    it("returns 404 for non-existent template", async () => {
      const response = await SELF.fetch(
        "http://localhost/api/templates/non-existent-template-id"
      );

      expect(response.status).toBe(404);

      const json = await response.json();
      expect(json.error).toBe("Template not found");
    });
  });

  describe("PUT /api/templates/:id", () => {
    it("updates template name", async () => {
      const { id } = await createTestTemplate({
        name: "Original Name",
        content: "Original content",
      });

      const newName = `Updated Name ${Date.now()}`;
      const response = await SELF.fetch(
        `http://localhost/api/templates/${id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newName }),
        }
      );

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.name).toBe(newName);
      expect(json.content).toBe("Original content"); // contentは変わらない
    });

    it("updates template content", async () => {
      const { id } = await createTestTemplate({
        name: "Content Update Test",
        content: "Original content",
      });

      const newContent = "Updated content with new {{variables}}";
      const response = await SELF.fetch(
        `http://localhost/api/templates/${id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: newContent }),
        }
      );

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.content).toBe(newContent);
    });

    it("updates both name and content", async () => {
      const { id } = await createTestTemplate({
        name: "Full Update Test",
        content: "Original content",
      });

      const updates = {
        name: `Full Updated Name ${Date.now()}`,
        content: "Fully updated content",
      };

      const response = await SELF.fetch(
        `http://localhost/api/templates/${id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        }
      );

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.name).toBe(updates.name);
      expect(json.content).toBe(updates.content);
      // updatedAtが更新されていることを確認
      expect(json.updatedAt).toBeDefined();
    });

    it("returns 404 for non-existent template", async () => {
      const response = await SELF.fetch(
        "http://localhost/api/templates/non-existent-template-id",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Updated" }),
        }
      );

      expect(response.status).toBe(404);

      const json = await response.json();
      expect(json.error).toBe("Template not found");
    });
  });

  describe("DELETE /api/templates/:id", () => {
    it("deletes an existing template", async () => {
      const { id } = await createTestTemplate({
        name: "Template to Delete",
        content: "This will be deleted",
      });

      const response = await SELF.fetch(
        `http://localhost/api/templates/${id}`,
        {
          method: "DELETE",
        }
      );

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);

      // 削除後は取得できないことを確認
      const getResponse = await SELF.fetch(
        `http://localhost/api/templates/${id}`
      );
      expect(getResponse.status).toBe(404);
    });

    it("returns 404 for non-existent template", async () => {
      const response = await SELF.fetch(
        "http://localhost/api/templates/non-existent-template-id",
        {
          method: "DELETE",
        }
      );

      expect(response.status).toBe(404);

      const json = await response.json();
      expect(json.error).toBe("Template not found");
    });
  });

  describe("Template ID generation", () => {
    it("generates unique IDs for multiple templates", async () => {
      const template1 = await createTestTemplate({
        name: "Template 1",
        content: "Content 1",
      });

      const template2 = await createTestTemplate({
        name: "Template 2",
        content: "Content 2",
      });

      expect(template1.id).not.toBe(template2.id);
      expect(template1.id).toMatch(/^tmpl-/);
      expect(template2.id).toMatch(/^tmpl-/);
    });
  });

  describe("Default template", () => {
    it("creates template with isDefault: false by default", async () => {
      const response = await SELF.fetch("http://localhost/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Non-default Template",
          content: "Content",
        }),
      });

      expect(response.status).toBe(201);

      const json = await response.json();
      expect(json.isDefault).toBe(false);
    });

    it("sets template as default when isDefault: true", async () => {
      const response = await SELF.fetch("http://localhost/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Default Template",
          content: "Default content",
          isDefault: true,
        }),
      });

      expect(response.status).toBe(201);

      const json = await response.json();
      expect(json.isDefault).toBe(true);
    });

    it("clears other default when setting new default", async () => {
      // 最初にデフォルトテンプレートを作成
      const firstResponse = await SELF.fetch("http://localhost/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "First Default",
          content: "First content",
          isDefault: true,
        }),
      });
      const firstTemplate = await firstResponse.json();
      expect(firstTemplate.isDefault).toBe(true);

      // 2つ目のテンプレートをデフォルトに設定
      const secondResponse = await SELF.fetch("http://localhost/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Second Default",
          content: "Second content",
          isDefault: true,
        }),
      });
      const secondTemplate = await secondResponse.json();
      expect(secondTemplate.isDefault).toBe(true);

      // 1つ目のテンプレートを確認（デフォルトが解除されているはず）
      const checkResponse = await SELF.fetch(
        `http://localhost/api/templates/${firstTemplate.id}`
      );
      const checkJson = await checkResponse.json();
      expect(checkJson.isDefault).toBe(false);
    });

    it("updates isDefault via PUT", async () => {
      const { id } = await createTestTemplate({
        name: "Template to set default",
        content: "Content",
      });

      // デフォルトに設定
      const updateResponse = await SELF.fetch(
        `http://localhost/api/templates/${id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isDefault: true }),
        }
      );

      expect(updateResponse.status).toBe(200);

      const json = await updateResponse.json();
      expect(json.isDefault).toBe(true);
    });

    it("clears default from other templates when updating isDefault", async () => {
      // 最初のテンプレートを作成してデフォルトに設定
      const first = await createTestTemplate({
        name: "First for update test",
        content: "Content 1",
      });

      await SELF.fetch(`http://localhost/api/templates/${first.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });

      // 2つ目のテンプレートを作成
      const second = await createTestTemplate({
        name: "Second for update test",
        content: "Content 2",
      });

      // 2つ目をデフォルトに設定
      await SELF.fetch(`http://localhost/api/templates/${second.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });

      // 1つ目のテンプレートを確認
      const checkFirst = await SELF.fetch(
        `http://localhost/api/templates/${first.id}`
      );
      const firstJson = await checkFirst.json();
      expect(firstJson.isDefault).toBe(false);

      // 2つ目のテンプレートを確認
      const checkSecond = await SELF.fetch(
        `http://localhost/api/templates/${second.id}`
      );
      const secondJson = await checkSecond.json();
      expect(secondJson.isDefault).toBe(true);
    });
  });
});
