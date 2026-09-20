/**
 * Cloudflare Worker 環境変数
 */
export interface Env {
  R2_BUCKET: R2Bucket;
  PODCAST_TITLE: string;
  WEBSITE_URL: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_PUBLIC_URL: string; // e.g., https://bucket.account.r2.dev or custom domain
  // Cloudflare Access
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_AUD: string;
  // Deploy Hook（Cloudflare Pages）
  WEB_DEPLOY_HOOK_URL?: string;
  // Bluesky
  BLUESKY_IDENTIFIER?: string; // ハンドル or DID
  BLUESKY_PASSWORD?: string; // アプリパスワード
  // Cloudflare Pages API（ビルド状況確認用）
  CLOUDFLARE_API_TOKEN?: string;
  PAGES_PROJECT_NAME?: string;
  // Spotify
  SPOTIFY_CLIENT_ID?: string;
  SPOTIFY_CLIENT_SECRET?: string;
  // Anthropic API（文字起こしのLLM校正）
  ANTHROPIC_API_KEY?: string;
  // ローカル開発用
  IS_DEV?: string;
}

/**
 * 話者トラックの割り当て
 *
 * label が null のトラックは BGM などの非発話トラックで、話者判定の候補から外す。
 */
/**
 * 話者のアイコン
 *
 * 公開サイトで名前の代わりに出す。番組の既定（あずま・鉄塔）に加えて、
 * ゲスト回ではエピソードごとに足せる。
 */
export interface SpeakerIcon {
  /** 話者名。文字起こしの話者ラベルと一致させる */
  name: string;
  url: string;
}

export interface SpeakerTrackAssignment {
  track: number;
  label: string | null;
}

/**
 * セグメント統合の設定
 */
export interface MergeSettings {
  enabled: boolean;
  /** これ以上の間が空いていたら統合しない（秒）。null なら間を条件にしない */
  maxGapSec: number | null;
  /** 統合後の 1 セグメントの最大長（秒） */
  maxDurationSec: number;
  /** 統合後の 1 セグメントの最大文字数 */
  maxChars: number;
}

/**
 * 誤字修正の置換ルール
 */
export interface CorrectionRule {
  from: string;
  to: string;
  enabled: boolean;
  /** なぜこのルールを入れたか（管理画面での判断材料） */
  note?: string;
}

/**
 * この回かぎりの修正が当たる場所
 *
 * 修正は「ある時点の本文の、ある箇所についての判断」なので、その箇所だけに当てる。
 * 以前は回全体の文字列置換だったため、取り直しをまたいで規則が積み上がり、正しい
 * 本文を壊していた。#281 では `悲劇 → 喜劇` と `喜劇 → 悲劇` が別々の取り直しで
 * 入り、最初から正しかった「喜劇か悲劇か」が「悲劇か悲劇か」になって公開された。
 * `不安 → ぶあー`（「不安って開発する」用）は「不安障害」まで書き換えた。
 */
export interface CorrectionAnchor {
  /** 当てる行の時刻（秒）。整形後の行の start〜end */
  start: number;
  end: number;
  /**
   * from の直前・直後の文字
   *
   * 同じ行に from が複数あるときの見分けと、取り直しで本文が変わったことの検出に使う。
   * 前後まで含めて一致しなければ、その判断の対象だった本文はもう無いので当てない
   */
  before: string;
  after: string;
}

/**
 * 修正の出どころ。通読の名指しで確定したものは、あとの見直しで触らせない
 *
 * suspicion は、機械（Jev）が怪しいと順位付けした行を claude が見直して出した直し
 */
export const CORRECTION_SOURCES = [
  "glossary",
  "review",
  "readback",
  "suspicion",
  "human",
] as const;
export type CorrectionSource = (typeof CORRECTION_SOURCES)[number];

/**
 * この回かぎりの修正
 *
 * anchor の無いものは古い形（回全体に当たる）。次の整形で、そのとき実際に
 * 変えている箇所へ場所つきで書き直される。
 */
export interface EpisodeCorrectionRule extends CorrectionRule {
  anchor?: CorrectionAnchor;
  source?: CorrectionSource;
}

/**
 * 確認カード（人が音声を聞いて決める箇所）
 *
 * 機械（Jev の順位付け → claude の見直し、読み返し）が「怪しいが決められない」とした行。
 * 管理画面で 1 枚ずつ、その区間の音を聞きながら決める。
 *
 * **人が確認した結果はここに残す。** 修正規則（EpisodeCorrectionRule）はそこから作る
 * 派生物で、取り直しで本文が変われば失効して消える。消えても、確認した行の全文は
 * ここにあるので、前回の判断を添えてカードを戻せる。規則だけに持たせると前後 8 文字
 * しか残らず、人の時間というこの仕組みでいちばん高い元手が痩せる。
 */
export interface ReviewCard {
  id: string;
  /** 行の時刻（秒） */
  start: number;
  end: number;
  /** カードを作ったときの行の本文 */
  line: string;
  /** なぜ引っかかったか。考えられる候補もここに書いてある */
  reason: string;
  /** 直したあとの行の形の候補（行まるごと）。無いこともある */
  candidates: string[];
  /** 校正前の音声認識の出力。前の校正が手を入れた行にだけ付く */
  whisper?: string;
  source: "suspicion" | "readback";
  createdAt: string;
  /**
   * 人が決めた結果。text は確認した行の全文（keep なら据え置いた形、fix なら直した形）
   *
   * correction は、fix のときに登録した修正。押し間違いを取り消すときに、これで探して外す
   */
  resolution?: {
    action: "keep" | "fix";
    text: string;
    at: string;
    correction?: { from: string; to: string };
  };
}

/** R2 に保存する形（episodes/{storageKey}/review-cards.json） */
export interface ReviewCardsData {
  cards: ReviewCard[];
}

/**
 * 相槌の整形設定
 *
 * 「うんうんうんうんうんうん」のような相槌は実際にそう喋っていても、文字で読むと
 * くどい。読みやすさのために回数を抑える。
 */
/**
 * 言いよどみの扱い
 */
export interface FillerSettings {
  enabled: boolean;
  /** 落とす語。読点で挟まれたもの、行頭のものが対象 */
  words: string[];
}

export interface BackchannelSettings {
  enabled: boolean;
  /** 対象にする相槌の単位 */
  units: string[];
  /** 何回までに抑えるか */
  maxRepeat: number;
  /**
   * 相槌だけのセグメントを丸ごと落とすか
   *
   * 「はい。」「なるほど。」のように、それだけで1つのセグメントになっている
   * ものを消す。実際に発話されていても、文字で読むと相槌が並ぶだけになるため。
   */
  dropStandalone: boolean;
  /** 丸ごと落とす対象の語。ここに完全一致するものだけを消す */
  standalonePhrases: string[];
}

/**
 * ハルシネーション除去の設定
 *
 * Whisper が無音や環境音に対して出力してしまう定型句と、同じ言葉を繰り返し続ける
 * 状態への対処。
 */
export interface HallucinationSettings {
  /** セグメント全体がこの語と一致したら削除する */
  phrases: string[];
  /**
   * 行頭に付く架空の話者ラベル（「深井 」「ヤンヤン 」）。学習元の話者名を Whisper が
   * 行頭に書く典型的なハルシネーション。文字起こし側が同じ回で繰り返し見つけたものを
   * 登録してくるので、次の回からは 1 回しか出なくても剥がせる
   */
  leadingLabels: string[];
  /** 同じ単位がこの回数を超えて繰り返されたら切り詰める */
  maxRepeat: number;
  /** 同じ文のセグメントがこの回数を超えて続いたら畳む */
  maxConsecutive: number;
}

/**
 * 文字起こし整形の設定
 *
 * 番組全体の既定値。エピソードごとの話者割り当ては EpisodeMeta.speakerTracks で上書きする。
 */
/**
 * 校正が見つけた、辞書に入れたい規則の提案
 *
 * 自動では入れない。辞書は番組全体に効くので、機械の判断で足すと
 * 公開中の文章を壊す。実際に `メール → mail` と `短期 → 短気` が入り、
 * 「メールフォーム」と「短期的には」まで置き換わった。
 */
export interface CorrectionProposal {
  from: string;
  to: string;
  /** なぜ誤認識と判断したか */
  note?: string;
  /** どのエピソードで見つかったか */
  episodeId: string;
  /** そのエピソードでの出現回数 */
  occurrences: number;
  proposedAt: string;
}

export interface TranscriptRefineSettings {
  speakerDefaults: SpeakerTrackAssignment[];
  /** 話者のアイコン。公開サイトで名前の代わりに出す */
  speakerIcons?: SpeakerIcon[];
  /** 校正が見つけた、辞書に入れたい規則の提案。人が承認するまで効かない */
  proposals?: CorrectionProposal[];
  merge: MergeSettings;
  corrections: CorrectionRule[];
  /**
   * 同時発話を検出する範囲（冒頭からの秒数）。null なら検出しない。
   *
   * 番組冒頭で声を揃える箇所のように、同時発話が起きる場所が決まっている場合にだけ
   * 指定する。本編の会話中まで検出を効かせると、相槌のかぶりや同時に笑った箇所を
   * 拾ってしまい、誤検出のほうが圧倒的に多くなる。
   */
  simultaneousUntilSec?: number | null;
  /** ハルシネーション除去の設定 */
  hallucination?: HallucinationSettings;
  /** 相槌の整形設定 */
  /**
   * 相槌の扱い。既定と同じ項目は保存しない
   *
   * 全項目を持たせると、コード側の既定を更新しても保存された古い値が使われ続ける。
   */
  backchannel?: Partial<BackchannelSettings>;
}

/**
 * Podcast 全体のインデックス (index.json)
 * 公開用: published のエピソードのみ含む
 */
export interface PodcastIndex {
  podcast: {
    title: string;
    description: string;
    author: string;
    email: string;
    language: string;
    category: string;
    artworkUrl: string;
    websiteUrl: string;
    explicit: boolean;
    applePodcastsId: string | null; // Apple Podcasts ID (collectionId)
    applePodcastsAutoFetch: boolean; // 管理画面起動時に自動取得するか
    spotifyShowId: string | null; // Spotify Show ID
    spotifyAutoFetch: boolean; // 管理画面起動時に自動取得するか
    // 購読リンク
    applePodcastsUrl?: string;
    spotifyUrl?: string;
    // 配信アナリティクス
    analyticsPrefix?: string; // オーディオURLに付与するプレフィックス (例: https://op3.dev/e/)
    // 文字起こしの整形設定（話者の既定割り当て・統合条件・誤字辞書）
    transcriptRefine?: TranscriptRefineSettings;
  };
  episodes: Array<{
    id: string;
    storageKey: string; // R2ディレクトリ名（推測不能）
  }>;
  scheduledEpisodeIds?: string[]; // 予約投稿待ちエピソードのID一覧（Cron最適化用）
  feedDirty?: boolean; // feed.xml の再生成待ちフラグ（Cronが処理する）
  // 文字起こし待ち/処理中エピソードのID一覧（キュー取得の全件走査を避けるため）
  // undefined の場合は未構築を意味し、次回のキュー取得時に全件走査で初期化される
  transcriptionQueueIds?: string[];
  // 整形のやり直し待ちエピソードのID一覧（Cronが少しずつ処理する）
  // 辞書や統合条件を変えたときに全エピソードへ再適用するために使う
  transcriptReprocessIds?: string[];
  // 描画待ち（OK が出た）の切り抜きの一覧（"エピソードID/切り抜きID" の形）。
  // 手元の道具が 1 時間おきに /api/clips/pending を叩くため、全件走査で読むと
  // Worker のリソース制限に達する。undefined の場合は未構築を意味し、次回の
  // 巡回時に全件走査で初期化される
  clipRenderIds?: string[];
  // 投稿待ち（描き終わっていて、まだ出していない投稿先がある）の切り抜きの一覧。
  // Cron が読む。clipRenderIds と一緒に初期化される
  clipPostIds?: string[];
  // 未確認の確認カードがあるエピソードの ID 一覧。管理画面の「確認待ち」が読む。
  // undefined は未構築（この機能より前の状態）で、カードが初めて届いたときに作る
  reviewCardIds?: string[];
  // 公開サイトの作り直し待ち。確認カードを 1 枚決めるたびにビルドを走らせると、50 枚で
  // 50 回走る。旗だけ立てて、Cron が 1 回にまとめる
  webRebuildPending?: boolean;
}

/**
 * 公開ステータス
 */
export type PublishStatus =
  | "new"        // エピソード作成直後、音声なし
  | "uploading"  // 音声アップロード/ダウンロード中
  | "draft"      // 音声あり、公開予約なし
  | "scheduled"  // 公開予約済み
  | "published"; // 公開済み

/**
 * 文字起こしステータス
 */
export type TranscribeStatus =
  | "none"         // 文字起こし未開始
  | "pending"      // キュー待ち
  | "transcribing" // 文字起こし中
  | "completed"    // 完了
  | "failed"       // 失敗
  | "skipped";     // スキップ

/**
 * @deprecated 後方互換性のため残す。新コードでは PublishStatus と TranscribeStatus を使用
 */
export type EpisodeStatus =
  | "draft"
  | "uploading"
  | "processing"
  | "transcribing"
  | "scheduled"
  | "published"
  | "failed";

/**
 * 参考リンク
 */
export interface ReferenceLink {
  url: string;
  title: string;
}

/**
 * エピソードメタデータ (meta.json)
 */
export interface EpisodeMeta {
  id: string;
  slug: string;
  storageKey: string; // R2ディレクトリ名（{slug}-{random}）
  title: string;
  description: string;
  duration: number;
  fileSize: number;
  audioUrl: string;
  sourceAudioUrl: string | null; // 外部参照の音声URL（インポート時）
  sourceGuid: string | null; // RSSのGUID（差分インポート用）
  transcriptUrl: string | null;
  artworkUrl: string | null; // エピソード固有のアートワーク（nullの場合はPodcastのアートワークを使用）
  skipTranscription: boolean;
  publishStatus: PublishStatus;
  transcribeStatus: TranscribeStatus;
  createdAt: string;
  publishAt: string | null; // nullの場合はドラフト
  publishedAt: string | null;
  // Bluesky 自動投稿
  blueskyPostText: string | null; // 投稿テキスト（事前登録）
  blueskyPostEnabled: boolean; // 公開時にBlueskyに投稿するか
  blueskyPostedAt: string | null; // 投稿済みの場合の日時
  // 参考リンク
  referenceLinks: ReferenceLink[];
  // Apple Podcasts
  applePodcastsUrl: string | null; // エピソード個別URL
  applePodcastsFetchedAt?: string | null; // 自動取得を最後に試みた日時
  // Spotify
  spotifyUrl: string | null; // エピソード個別URL
  // 文字起こしロック（ソフトロック、1時間で自動解除）
  transcriptionLockedAt?: string | null;
  // 文字起こし失敗時のエラーメッセージ
  transcriptionErrorMessage?: string | null;
  // Claude が書いたエピソードの感想（公開サイトに掲載する）
  claudeImpression?: string | null;
  claudeImpressionAt?: string | null;
  // 話者トラック（zip）をアップロード済みの場合の日時
  tracksUploadedAt?: string | null;
  // エピソード固有の話者割り当て。null / undefined なら番組の既定値を使う
  speakerTracks?: SpeakerTrackAssignment[] | null;
  // Whisper の生出力（話者判定済み・整形前）の URL
  transcriptRawUrl?: string | null;
  /**
   * この回だけの話者アイコン
   *
   * ゲスト回で使う。番組の既定に足す形で、同じ名前があればこちらが勝つ。
   */
  speakerIcons?: SpeakerIcon[] | null;
  /**
   * 保存した話者トラック
   *
   * 圧縮して個別に置く。切り抜き動画など、文字起こし以外の用途で使えるように。
   */
  speakerTrackFiles?: Array<{ track: number; label: string; url: string }> | null;
  /**
   * この回かぎりの誤字修正
   *
   * 番組全体の辞書に入れると誤爆するもの（「ソロスを」→「そろそろ」など）を、
   * このエピソードだけに当てる。番組全体の辞書のあとに適用する。
   */
  transcriptCorrections?: EpisodeCorrectionRule[] | null;
  /** トラックごとの音量（波形）。正解データ作成画面が読む */
  levelsUrl?: string | null;
}

/**
 * 新規エピソード作成リクエスト
 */
export interface CreateEpisodeRequest {
  title: string;
  slug?: string;
  description?: string;
  publishAt?: string | null;
  skipTranscription?: boolean;
  blueskyPostText?: string | null;
  blueskyPostEnabled?: boolean;
  referenceLinks?: ReferenceLink[];
}

/**
 * エピソード更新リクエスト
 */
export interface UpdateEpisodeRequest {
  title?: string;
  slug?: string;
  description?: string;
  publishAt?: string | null;
  skipTranscription?: boolean;
  blueskyPostText?: string | null;
  blueskyPostEnabled?: boolean;
  referenceLinks?: ReferenceLink[];
  // Apple Podcasts（管理画面から編集可能）
  applePodcastsUrl?: string | null;
  applePodcastsFetchedAt?: string | null;
  // Spotify（管理画面から編集可能）
  spotifyUrl?: string | null;
  // 文字起こしリトライ用（failed → pending）
  transcribeStatus?: TranscribeStatus;
}

/**
 * 話者トラック zip のアップロード完了通知
 */
export interface TracksUploadCompleteRequest {
  /** トラック番号への話者割り当て。省略時は番組の既定値を使う */
  speakerTracks?: SpeakerTrackAssignment[] | null;
}

/**
 * 文字起こし完了通知リクエスト
 */
export interface TranscriptionCompleteRequest {
  transcribeStatus: "completed" | "failed";
  duration?: number;
  errorMessage?: string;
}

/**
 * 文字起こしセグメント（Whisper互換 + 話者情報対応）
 */
export interface TranscriptSegment {
  start: number; // 開始時間（秒）
  end: number; // 終了時間（秒）
  text: string;
  speaker?: string; // 話者ID（将来の話者分離用）
}

/**
 * 文字起こしJSON形式（R2に保存）
 */
export interface TranscriptData {
  segments: TranscriptSegment[];
  language?: string;
  /** いつ整形したか。この本文がどの時点の設定で作られたかを辿るため */
  refinedAt?: string;
  /**
   * 当てた置換規則の数（番組の辞書 / この回かぎり）
   *
   * episodeUnmatched は、場所つきの修正のうち本文が合わず当たらなかった数。
   * 設定を変えて行の形が変わったとき、取り直しで本文が変わったときに増える
   */
  appliedRules?: { dictionary: number; episode: number; episodeUnmatched?: number };
}

/**
 * その回の用語集（R2 に保存）
 *
 * 校正の前に文字起こしを通して読んで集めたもの。校正に渡すために作るが、
 * 番組の用語辞典の材料にもなるので残す。綴りは Web で確かめたものだけが入る。
 */
export interface GlossaryTerm {
  /** 正しいと確かめた綴り */
  term: string;
  /** サービス名・人名・専門用語・造語・店名 */
  kind?: string;
  /** 何のことか。本文のどこに出てくるかも書かれている */
  note?: string;
  /** 本文での書かれ方。正しい綴りと違うことがある */
  asWritten?: string;
  /** 参考リンクに載せる価値があるか（一般名詞ではなく説明が要るもの） */
  notable?: boolean;
  /** 参考リンクの URL。Web で確かめたものだけ */
  url?: string;
  /** 綴りを確かめた根拠 */
  evidence?: string;
  /** その語が誤認識されていそうな箇所 */
  suspects?: Array<{ index: number; text: string; guess?: string }>;
}

export interface GlossaryData {
  terms: GlossaryTerm[];
  /** いつ集めたか */
  collectedAt: string;
}

/**
 * 文字起こしキューのエピソード情報
 */
export interface TranscriptionQueueItem {
  id: string;
  slug: string;
  title: string;
  audioUrl: string;
  sourceAudioUrl: string | null; // 外部参照URL（RSSインポート時）
  duration: number;
  lockedAt: string; // ロック取得時刻
  // 話者トラックの zip がある場合のダウンロード URL（Presigned、有効期限あり）
  tracksZipUrl?: string | null;
  // トラック番号 → 話者名。エピソード固有の設定があればそれ、なければ番組の既定値
  speakerTracks?: SpeakerTrackAssignment[];
  // 同時発話を検出する範囲（冒頭からの秒数）。null / 未設定なら検出しない
  simultaneousUntilSec?: number | null;
  // エピソードの概要。冒頭の要約を initial_prompt に足すのに使う
  description?: string;
  // 参考リンク。タイトルにその回の固有名詞（メーカー名・製品名）の正しい綴りが
  // あるので、文字起こし側が語彙（hotwords・校正）に足す
  referenceLinks?: ReferenceLink[];
  // これまでに学習した、行頭の架空の話者ラベル。文字起こし側が Whisper の出力から剥がす
  hallucinationLabels?: string[];
  // すでに文字起こしがあるか。取り直しかどうかの判断に使う
  // （取り直しの通知を関係者全員に送ると迷惑なので、宛先を絞る）
  isRetranscribe?: boolean;
}

/**
 * 文字起こしキューレスポンス
 */
export interface TranscriptionQueueResponse {
  episodes: TranscriptionQueueItem[];
}

/**
 * Presigned URL 発行リクエスト
 */
export interface UploadUrlRequest {
  contentType: string;
  fileSize: number;
}

/**
 * Presigned URL 発行レスポンス
 */
export interface UploadUrlResponse {
  uploadUrl: string;
  expiresIn: number;
}

/**
 * アップロード完了通知リクエスト
 */
export interface UploadCompleteRequest {
  duration: number;
  fileSize?: number;  // 開発時のみ使用（R2 Binding が使えない場合）
}

/**
 * URL からアップロードリクエスト
 */
export interface UploadFromUrlRequest {
  sourceUrl: string;
}

/**
 * エピソード一覧レスポンス
 */
export interface EpisodesListResponse {
  episodes: Array<{
    id: string;
    title: string;
    publishStatus: PublishStatus;
    transcribeStatus: TranscribeStatus;
    publishAt: string | null;
    publishedAt: string | null;
    createdAt: string;
  }>;
}

/**
 * エピソード作成レスポンス
 */
export interface CreateEpisodeResponse {
  id: string;
  slug: string;
  publishStatus: PublishStatus;
  transcribeStatus: TranscribeStatus;
}

/**
 * 概要欄テンプレート
 */
export interface DescriptionTemplate {
  id: string;
  name: string;
  content: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * テンプレート一覧 (templates/descriptions.json)
 */
export interface TemplatesIndex {
  templates: DescriptionTemplate[];
}

/**
 * テンプレート作成/更新リクエスト
 */
export interface TemplateRequest {
  name: string;
  content: string;
  isDefault?: boolean;
}

/**
 * Podcast 設定更新リクエスト
 */
export interface UpdatePodcastSettingsRequest {
  title?: string;
  description?: string;
  author?: string;
  email?: string;
  language?: string;
  category?: string;
  websiteUrl?: string;
  explicit?: boolean;
  applePodcastsId?: string | null;
  applePodcastsAutoFetch?: boolean;
  spotifyShowId?: string | null;
  spotifyAutoFetch?: boolean;
  // 購読リンク
  applePodcastsUrl?: string;
  spotifyUrl?: string;
  // 配信アナリティクス
  analyticsPrefix?: string | null;
  // 文字起こしの整形設定（話者の既定割り当て・統合条件・誤字辞書）
  transcriptRefine?: TranscriptRefineSettings;
}

/**
 * RSSインポートリクエスト
 */
export interface ImportRssRequest {
  rssUrl: string;
  importAudio?: boolean; // trueの場合は音声もダウンロード
  importArtwork?: boolean; // trueの場合はエピソードアートワークもダウンロード
  importPodcastSettings?: boolean; // trueの場合はPodcast設定も上書き
  customSlugs?: Record<string, string>; // インデックス(0始まり) → カスタムslug のマッピング
  skipTranscription?: boolean; // trueの場合は文字起こしをスキップ（デフォルト: true）
}

/**
 * RSSインポートレスポンス
 */
export interface ImportRssResponse {
  imported: number;
  skipped: number;
  episodes: Array<{
    title: string;
    slug: string;
    status: "imported" | "skipped";
    reason?: string;
  }>;
}

/**
 * Cloudflare Pages デプロイステータス
 */
export type DeploymentStage =
  | "queued"
  | "initializing"
  | "cloning"
  | "building"
  | "deploying"
  | "success"
  | "failure";

/**
 * デプロイ情報
 */
export interface Deployment {
  id: string;
  shortId: string;
  url: string;
  createdOn: string;
  modifiedOn: string;
  latestStage: {
    name: DeploymentStage;
    status: "idle" | "active" | "success" | "failure";
    startedOn: string | null;
    endedOn: string | null;
  };
  deploymentTrigger: {
    type: string;
    metadata: {
      branch?: string;
      commitHash?: string;
      commitMessage?: string;
    };
  };
}

/**
 * デプロイ一覧レスポンス
 */
export interface DeploymentsResponse {
  deployments: Deployment[];
  configured: boolean;
  websiteUrl?: string;
  accountId?: string;
  projectName?: string;
}

// ---------------------------------------------------------------------------
// 切り抜き動画
//
// 描画はクラウドではできない（ffmpeg も素材も手元にある）。一方、確かめて直すのに
// 描画は要らない。音声は R2 にあり、字幕は文字と時刻の並びでしかない。だから
// 確かめて直すところまでを管理画面で済ませ、手元には決まったものを描かせるだけにする。
// 詳しくは docs/clip-viewer-spec.md を参照。
// ---------------------------------------------------------------------------

/**
 * 切り抜きの状態。
 *
 * draft → approved（OK。描画待ち）→ rendered（3 本揃った。投稿待ち）→ published。
 * approved と rendered は OK を取り消せば draft に戻る。published は戻らない
 */
export type ClipStatus = "draft" | "approved" | "rendered" | "published" | "rejected";

export type ClipLayoutName = "portrait" | "landscape" | "square";

export const CLIP_LAYOUTS: ClipLayoutName[] = ["portrait", "landscape", "square"];

export type ClipPostTarget = "bluesky" | "x" | "youtube" | "instagram";

export const CLIP_POST_TARGETS: ClipPostTarget[] = ["bluesky", "x", "youtube", "instagram"];

/**
 * 投稿先ひとつ分の予定と結果
 */
export interface ClipPost {
  enabled: boolean;
  layout: ClipLayoutName;
  postedAt: string | null;
  url: string | null;
  error: string | null;
}

/**
 * 描いた版。上書きせずに積む。投稿済みの動画がどの下書きから描かれたかを
 * 後から追えるようにするため
 */
export interface ClipVersion {
  n: number;
  createdAt: string;
  /** 描いたときの下書きの revision。下書きより前の版には無い */
  revision?: number;
  /** 置いてある動画。下書きより前の版には無く、v{n}/clip.mp4 が 1 本あるだけ */
  layouts?: ClipLayoutName[];
  note?: string;
}

/**
 * 切り抜き 1 本分
 */
export interface ClipMeta {
  id: string;
  episodeId: string;
  /** 画面に出す短い名前 */
  label: string;
  latest: number;
  status: ClipStatus;
  /** OK を出したときの下書きの revision。描く側はこれと違う下書きを描かない */
  approvedRevision: number | null;
  versions: ClipVersion[];
  /** 投稿する日時。無ければ描くだけで投稿しない */
  publishAt: string | null;
  postText: string;
  posts: Record<ClipPostTarget, ClipPost>;
  /** 下書きより前に作られた切り抜きの区間。再生するだけで、直せない */
  range?: [string, string];
  clip?: { start: number; duration: number };
}

/**
 * エピソードごとの切り抜き一覧
 */
export interface ClipIndex {
  clips: Array<{ id: string; label: string; latest: number; status: ClipStatus }>;
}

/**
 * 字幕 1 枚。時刻はすべてエピソードの音声上の秒。
 *
 * of と chars は元の書き起こしから来たもので、管理画面は書き換えない。生成側は
 * of を連ねたものが元の書き起こしと一字一句一致することを確かめてから描く。
 * 字幕と音がずれるのを防ぐ関門で、直せるのは rows と skip だけ
 */
export interface ClipDraftSub {
  id: string;
  speaker: string;
  start: number;
  end: number;
  /** 元の書き起こしの文字。足した字幕では "" */
  of: string;
  /** of の 1 字ごとの読み始め。数は of の字数（コードポイント）と同じ */
  chars: number[];
  /** 画面に出す文字と改行。連ねたものが of と違えば、文字を直したということ */
  rows: string[];
  /** 字幕を出さない。音は残る */
  skip: boolean;
}

/**
 * 画面中央に出す画像 1 枚
 */
export interface ClipDraftCard {
  at: number;
  word: string;
  image: string;
  source?: string;
}

/**
 * 元の音声から取り出す 1 区間。時刻はエピソードの音声上の秒
 */
export interface ClipSpan {
  id: string;
  /**
   * AI が選んだひとまとまり。無音を詰めると 1 つのまとまりが複数の区間に割れるので、
   * 画面ではこれで束ねて見せる
   */
  group: string;
  start: number;
  end: number;
  /** この区間のあとに挟む間。null なら下書きの gap。最後の区間では末尾の余韻 */
  gap: number | null;
  /** AI がそこを選んだ理由 */
  note?: string;
  /** 鳴らさない。消さずに外しておけば戻せる */
  off?: boolean;
}

/**
 * その回の音声を、ブラウザが途中だけ取って復号するための手掛かり。手元が mp3 を調べて書く。
 * 固定ビットレートなら時刻とバイト位置が比例するので、必要な範囲だけを Range で取れる
 */
export interface ClipAudioInfo {
  format: string;
  headerBytes: number;
  bitrate: number;
  sampleRate: number;
  /** 復号した波形の頭から捨てるサンプル数（エンコーダの遅延ぶん） */
  skipSamples: number;
}

/**
 * 下書き。プレビューと編集の対象。
 *
 * 切り抜きは連続した 1 区間とは限らない。離れた区間を選び、並べ替え、間を落として
 * 繋ぐ。どこをどの順に繋ぐかを決めるのは手元の AI で、下書きはその結果を区間の並びとして
 * 持つ。時刻はすべて元の音声の上の秒で、繋いだあとの時刻は並びからそのつど計算する
 */
export interface ClipDraft {
  /** 保存のたびに 1 増える。食い違う保存は弾く */
  revision: number;
  /**
   * 再生の速さ。ショート動画は少し速いほうが見やすいので、既定は 1.2。
   * 繋いだ音声と映像を、最後に丸ごと速める
   */
  speed: number;
  /** 継ぎ目に挟む間の既定 */
  gap: number;
  /** 区間の両端に掛けるフェード。波形を途中で断ち切るとプツッと鳴る */
  edgeFade: number;
  /**
   * 区間の端を字幕に合わせて置くときに、前後へ足す余白。字幕の start は最初の字が
   * 鳴り始めた時刻なので、そこちょうどで切ると頭の子音が食われる
   */
  lead: number;
  trail: number;
  audio: ClipAudioInfo;
  /** 下書きが字幕を持っている範囲。区間の端はこの中でしか動かせない */
  pool: Array<{ start: number; end: number }>;
  /** 鳴らす順に並ぶ。元の音声での順とは限らない */
  spans: ClipSpan[];
  /** pool 全体について、元の音声の順に並ぶ */
  subs: ClipDraftSub[];
  cards: ClipDraftCard[];
}

export const CLIP_DEFAULT_SPEED = 1.2;
export const CLIP_SPEED_RANGE: [number, number] = [0.5, 2];

/**
 * 手元が拾う、描画待ちのもの
 */
export interface PendingClip {
  episodeId: string;
  storageKey: string;
  clipId: string;
  label: string;
  revision: number;
}
