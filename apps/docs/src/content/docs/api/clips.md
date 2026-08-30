---
title: 切り抜き動画 API
description: 管理画面から切り抜き動画を確認し、直しを指示する
sidebar:
  order: 6
---

エピソードから作った切り抜き動画を、管理画面で確認・修正指示・作り直しするための API です。

**描画はここではできません。** ffmpeg も素材も手元（WSL）にあるため、管理画面は
**指示を預かるだけ**で、実際の作り直しは手元の道具（[imagecaster-video](https://github.com/sngazm/imagecaster-video)）が引き取ります。

```
管理画面（Cloudflare）        手元（Mac / WSL）
  動画を見る
  直しを指示  ──→ R2 に置く
                        ↓  watch.py が拾う
                   Claude Code が読んで作り直す
                        ↓
                   v2 を R2 に上げる  ──→ 管理画面で見比べる
```

## エンドポイント一覧

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/episodes/:id/clips` | この回の切り抜き一覧 |
| GET | `/api/episodes/:id/clips/:clipId` | 切り抜き 1 本分の meta |
| PUT | `/api/episodes/:id/clips/:clipId` | 版を追加する（生成側から） |
| GET | `/api/episodes/:id/clips/:clipId/versions/:n/subs` | その版の字幕 |
| POST | `/api/episodes/:id/clips/:clipId/requests` | 直しの指示を預ける |
| PUT | `/api/episodes/:id/clips/:clipId/status` | OK / ボツ |
| GET | `/api/clips/pending` | 未処理の指示があるもの（手元が拾う） |

動画そのものは R2 の公開 URL から直接読みます。音声と同じ扱いで、Worker を通しません。
`GET /api/episodes/:id/clips/:clipId` のレスポンスに含まれる `baseUrl` を使い、
`{baseUrl}/v{n}/clip.mp4` が版ごとの動画です。

## R2 の置き場

```
episodes/{storageKey}/clips/
├── index.json                  この回の切り抜き一覧
└── {clipId}/
    ├── meta.json               区間・版の一覧・状態・指示
    ├── v1/
    │   ├── clip.mp4
    │   ├── subs.json           その版で使った字幕の区切り
    │   ├── cards.json          その版で出した画像
    │   └── manifest.json       画像の出どころ
    └── v2/ …
```

**版は上書きしません。** 作り直しても前の版は残ります。見比べたいのと、
悪くなったときに戻れるようにするためです。

## 直しの指示

字幕を**直接書き換えません**。字幕は音のタイムスタンプに紐づいているので、
文字だけ差し替えると音とずれます。指示として預かり、読んで区切りを決め直すのは
作り直す側（Claude Code）の仕事です。

```json
{ "type": "edit",   "index": 5, "text": "こう直してほしい" }
{ "type": "note",   "index": 5, "text": "区切りを前に寄せて" }
{ "type": "delete", "index": 7 }
{ "type": "insert", "afterIndex": 7, "text": "ここに入れたい" }
```

`index` はその版の字幕の通し番号です。版が変わると番号もずれるため、指示は
`baseVersion` でどの版に対するものかを持ちます。

反映された指示には `appliedIn` に版番号が入り、`GET /api/clips/pending` から外れます。
**印を付け忘れると手元が何度も拾ってしまいます。**

## 状態

`draft`（確認待ち）／ `approved`（OK）／ `rejected`（ボツ）。
OK を出したものだけが、あとで投稿予約に進みます。

詳しい設計の背景は `docs/clip-viewer-spec.md` を参照してください。
