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
  /** 同じ単位がこの回数を超えて繰り返されたら切り詰める */
  maxRepeat: number;
  /** 同じ文のセグメントがこの回数を超えて続いたら畳む */
  maxConsecutive: number;
}

/**
 * 文字起こし後処理の設定
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

export interface TranscriptPostProcessSettings {
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
    // 文字起こしの後処理設定（話者の既定割り当て・統合条件・誤字辞書）
    transcriptPostProcess?: TranscriptPostProcessSettings;
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
  // 後処理のやり直し待ちエピソードのID一覧（Cronが少しずつ処理する）
  // 辞書や統合条件を変えたときに全エピソードへ再適用するために使う
  transcriptReprocessIds?: string[];
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
  hideTranscription?: boolean; // 文字起こしを非表示にするか
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
  // Whisper の生出力（話者判定済み・後処理前）の URL
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
  transcriptCorrections?: CorrectionRule[] | null;
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
  hideTranscription?: boolean;
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
  // 文字起こしの後処理設定（話者の既定割り当て・統合条件・誤字辞書）
  transcriptPostProcess?: TranscriptPostProcessSettings;
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
