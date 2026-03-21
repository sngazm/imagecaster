---
title: RSS フィード
description: Podcast RSS フィードの生成と配信
sidebar:
  order: 3
---

## 概要

RSS フィード（`feed.xml`）は R2 に静的ファイルとして保存され、Cloudflare Pages から配信されます。

```
R2: feed.xml
  └─ Cloudflare Pages が /feed.xml として配信
```

Worker でフィードを動的生成するのではなく、静的ファイルとして配信することでリクエスト数を削減しています。

## フィードの更新タイミング

以下の操作で `feed.xml` が自動再生成されます。

- エピソードの公開（スケジュール公開含む）
- 公開済みエピソードのメタデータ更新
- 公開済みエピソードの削除
- Podcast 設定の更新

## フィード形式

RSS 2.0 + iTunes ポッドキャスト拡張仕様に準拠しています。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>My Podcast</title>
    <description>番組の説明</description>
    <link>https://your-podcast.example.com</link>
    <language>ja</language>
    <itunes:author>配信者名</itunes:author>
    <itunes:image href="https://pub-xxx.r2.dev/assets/artwork.jpg"/>
    <itunes:category text="Technology"/>
    <itunes:explicit>false</itunes:explicit>
    <item>
      <title>第1回 はじめに</title>
      <enclosure url="..." type="audio/mpeg" length="12345678"/>
      <pubDate>Mon, 01 Jan 2024 09:00:00 +0000</pubDate>
      <itunes:duration>1800</itunes:duration>
      <description>...</description>
    </item>
  </channel>
</rss>
```

## Apple Podcasts への登録

1. Podcast 設定で RSS フィード URL を確認
2. [Apple Podcasts Connect](https://podcastsconnect.apple.com/) にログイン
3. RSS フィード URL を入力して登録申請

承認後、管理画面の設定で **Apple Podcasts ID** を設定すると、エピソードごとの Apple Podcasts URL を自動取得できます。

## Spotify への登録

1. [Spotify for Podcasters](https://podcasters.spotify.com/) にアクセス
2. RSS フィード URL を入力して登録

承認後、管理画面の設定で **Spotify Show ID** を設定すると、エピソードごとの Spotify URL を自動取得できます。詳細は [Spotify 連携](./spotify/) を参照。
