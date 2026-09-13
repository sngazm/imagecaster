/**
 * 番組の出演者のアイコン
 *
 * 名前より速く誰の発言か分かる。ゲストのぶんは R2 の設定から届くので、
 * ここは毎回出る 2 人だけ。用意が無い話者は名前のまま出す。
 */
const BUILT_IN_ICONS: Record<string, string> = {
  あずま: "/speakers/azuma.jpg",
  鉄塔: "/speakers/tetto.jpg",
};

/** 複数人が同時に喋っている区間は "あずま・鉄塔" のように連結されて届く */
export const SIMULTANEOUS_SEPARATOR = "・";

/**
 * 番組の既定のアイコンに、その回のぶんを足す
 *
 * 同じ名前があればその回が勝つ。ゲスト回でだけ出る人を差し替えられるようにするため。
 */
export function resolveSpeakerIcons(
  icons: Record<string, string> = {}
): Record<string, string> {
  return { ...BUILT_IN_ICONS, ...icons };
}
