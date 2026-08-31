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
| POST | `/api/episodes/:id/clips/:clipId/upload-url` | 版の動画を置く Presigned URL |
| PUT | `/api/episodes/:id/clips/:clipId` | 版を追加する（生成側から） |
| GET | `/api/episodes/:id/clips/:clipId/versions/:n/subs` | その版の字幕 |
| POST | `/api/episodes/:id/clips/:clipId/requests` | 直しの指示を預ける |
| PUT | `/api/episodes/:id/clips/:clipId/status` | OK / ボツ |
| GET | `/api/clips/pending` | 未処理の指示があるもの（手元が拾う） |

動画そのものは R2 の公開 URL から直接読みます。音声と同じ扱いで、Worker を通しません。
`GET /api/episodes/:id/clips/:clipId` のレスポンスに含まれる `baseUrl` を使い、
`{baseUrl}/v{n}/clip.mp4` が版ごとの動画です。

## 版を上げる

生成側は 2 段階で載せます。**動画を先に置いてから登録します。** 逆にすると、
登録は済んでいるのに動画が無い版が管理画面に出ます。

```
POST /api/episodes/285/clips/c1/upload-url   →  { n, key, uploadUrl, expiresIn }
PUT  {uploadUrl}                                 動画（Content-Type: video/mp4）
PUT  /api/episodes/285/clips/c1                  版として登録
```

動画は数十 MB になるため Worker の本体には流しません。音声・アートワーク・話者
トラックと同じく、鍵は Worker が持ったまま置き場だけを渡します。`n` を省略すると
次の版を返すので、そのまま `PUT` で登録すれば番号が揃います。

登録の本文で、その版の中身も一緒に置けます。

```json
{
  "label": "脳が5つにちぎれる",
  "range": ["10:49", "11:47"],
  "clip": { "start": 644.0, "duration": 68.0 },
  "subs": [{ "index": 0, "speaker": "あずま", "start": 0, "end": 1.6, "rows": ["…"] }],
  "cards": [{ "at": 17.6, "word": "tmux", "image": "https://…" }],
  "manifest": { "…": "画像の出どころ" },
  "appliedRequest": "r1",
  "note": "字幕の指示を反映"
}
```

`subs` / `cards` / `manifest` はそれぞれ `v{n}/` の下に書かれます。

**版が積まれると `status` は `draft` に戻ります。** OK / ボツ はその版に対して
出したものなので、作り直したら見直しからやり直します。

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

### 巡回は索引を見る

手元の `watch.py` は 1 時間おきに `/api/clips/pending` を叩きます。全エピソードの
`meta.json` を読んでから各回の `clips/index.json` を読む作りだと、1 リクエストで
500 回以上 R2 を読むことになり、Worker のリソース制限（Error 1102）に達します。
文字起こしキューが同じ形で一度詰まっているため、同じ手当てをしてあります。

`index.json` の `clipRequestIds` に「未処理の指示がある切り抜き」を
`"エピソードID/切り抜きID"` の形で持ち、指示を預かったときと版が積まれたときに
更新します。巡回はこれに載っているものだけを読みます。

`clipRequestIds` が `undefined`（未構築）のときだけ全件走査して作り直します。
`transcriptionQueueIds` と同じ形です。

## 状態

`draft`（確認待ち）／ `approved`（OK）／ `rejected`（ボツ）。
OK を出したものだけが、あとで投稿予約に進みます。

詳しい設計の背景は `docs/clip-viewer-spec.md` を参照してください。
