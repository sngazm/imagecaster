---
title: テンプレート API
description: 概要欄テンプレートの管理
sidebar:
  order: 4
---

概要欄テンプレートを使うと、よく使う HTML テキストを保存・再利用できます。

## エンドポイント一覧

| メソッド | パス | 説明 |
|--------|------|------|
| `GET` | `/api/templates` | テンプレート一覧取得 |
| `POST` | `/api/templates` | テンプレート作成 |
| `GET` | `/api/templates/:id` | テンプレート詳細取得 |
| `PUT` | `/api/templates/:id` | テンプレート更新 |
| `DELETE` | `/api/templates/:id` | テンプレート削除 |

---

## GET /api/templates

テンプレート一覧を返します。

### レスポンス

```json
{
  "templates": [
    {
      "id": "tmpl_abc123",
      "name": "デフォルトテンプレート",
      "content": "<p>番組の説明...</p>",
      "isDefault": true,
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

---

## POST /api/templates

テンプレートを新規作成します。

### リクエストボディ

```typescript
interface TemplateRequest {
  name: string;
  content: string;        // HTML 形式
  isDefault?: boolean;    // デフォルト: false
}
```

`isDefault: true` を設定すると、他のテンプレートの `isDefault` は `false` になります（排他制御）。

### レスポンス

```json
{
  "id": "tmpl_abc123",
  "name": "デフォルトテンプレート",
  "content": "<p>...</p>",
  "isDefault": false,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

---

## GET /api/templates/:id

テンプレートの詳細を取得します。

---

## PUT /api/templates/:id

テンプレートを更新します。

### リクエストボディ

`POST /api/templates` と同じ `TemplateRequest` 形式。

---

## DELETE /api/templates/:id

テンプレートを削除します。

テンプレートデータは `templates.json` にまとめて保存されており、削除時はそのファイルを更新します。
