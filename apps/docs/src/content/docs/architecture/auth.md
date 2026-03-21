---
title: 認証 (Cloudflare Access)
description: Cloudflare Access による JWT 認証の仕組み
sidebar:
  order: 3
---

import { Aside } from '@astrojs/starlight/components';

Imagecaster の認証は **Cloudflare Access** に一元化されています。API キーは使いません。

## 仕組み

```
ブラウザ（管理画面）
  │
  ├─ Cloudflare Access でログイン
  │    └─ JWT トークンを取得
  │
  └─ API リクエスト
       └─ Cf-Access-Jwt-Assertion ヘッダーに JWT を付与
            └─ Worker が JWT を検証
                 └─ 成功: リクエスト処理
                 └─ 失敗: 401 Unauthorized
```

## Worker 側の JWT 検証

```typescript
import { createRemoteJWKSet, jwtVerify } from 'jose';

const JWKS = createRemoteJWKSet(
  new URL(`https://${TEAM_DOMAIN}/cdn-cgi/access/certs`)
);

// Cf-Access-Jwt-Assertion ヘッダーを検証
await jwtVerify(jwt, JWKS, { audience: ACCESS_AUD });
```

Cloudflare Access の公開鍵セット（JWKS）を使って署名を検証します。鍵は自動ローテーションされるため、鍵管理は不要です。

## Admin と Worker を同一アプリケーションに登録する理由

<Aside type="caution">
Admin と Worker は **必ず同一の** Cloudflare Access アプリケーションに登録してください。
</Aside>

Cloudflare Access では、アプリケーションごとに異なる **AUD（Audience）** が発行されます。

- Admin（Pages）と Worker（Workers）が別アプリケーションだと AUD が異なる
- Worker の JWT 検証で `audience` が一致せず 401 エラーになる
- 同一アプリケーションにすることで、同じ AUD の JWT が両方で有効になる

```
同一 Access Application
  ├─ admin.yourdomain.com       (Cloudflare Pages)
  └─ admin.yourdomain.com/api   (Worker routes で同一ドメインにマウント)
```

## 開発モード

`.dev.vars` に `IS_DEV=true` を設定すると、JWT 検証をスキップします。

```ini
IS_DEV=true
```

<Aside type="caution">
`IS_DEV=true` は本番環境では絶対に使用しないでください。認証が完全にバイパスされます。
</Aside>

## 認証不要のエンドポイント

`GET /api/health` は認証なしでアクセスできます。ヘルスチェック用途に使用します。

## 環境変数

| 変数名 | 説明 |
|--------|------|
| `CF_ACCESS_TEAM_DOMAIN` | Zero Trust チームドメイン（例: `yourteam.cloudflareaccess.com`） |
| `CF_ACCESS_AUD` | Access アプリケーションの AUD Tag |
| `IS_DEV` | `true` の場合、認証をスキップ（開発用） |
