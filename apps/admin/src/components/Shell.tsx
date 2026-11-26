import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { BuildStatus } from "./BuildStatus";
import { useTheme, type ThemeMode } from "../hooks/useTheme";
import { api } from "../lib/api";
import { getWebsiteUrl, getEnvironment } from "../lib/env";

const THEME_LABEL: Record<ThemeMode, string> = {
  light: "ライト",
  dark: "ダーク",
  system: "自動",
};

/**
 * 画面の枠で使う、番組の情報と確認待ちの件数
 *
 * 番組名は設定から出す（コードに書かない）。確認待ちは、件数と、押したときに
 * 開く最初の回を持っておく。
 */
function useShellData() {
  const [title, setTitle] = useState<string | null>(null);
  const [websiteUrl, setWebsiteUrl] = useState<string | null>(null);
  const [review, setReview] = useState<{ count: number; firstEpisodeId: string | null }>({
    count: 0,
    firstEpisodeId: null,
  });
  const location = useLocation();

  useEffect(() => {
    if (getEnvironment() === "local") {
      // ローカル環境ではダミー値を渡す（getWebsiteUrlがローカルURLに変換する）
      setWebsiteUrl(getWebsiteUrl("local"));
    }
    api
      .getSettings()
      .then((settings) => {
        // 「番組名 - ひとこと」の形なら番組名だけ出す
        setTitle(settings.title?.split(/\s+[-–—|｜]\s+/)[0] || null);
        if (settings.websiteUrl && getEnvironment() !== "local") {
          setWebsiteUrl(getWebsiteUrl(settings.websiteUrl));
        }
      })
      .catch((err) => {
        console.error("設定の取得に失敗しました:", err);
      });
  }, []);

  // 確認を済ませて戻ってきたときに件数が変わるので、画面を移るたびに数え直す
  useEffect(() => {
    api
      .getPendingReviewCards()
      .then((data) => {
        const open = data.episodes.filter((e) => e.open > 0);
        setReview({
          count: open.reduce((sum, e) => sum + e.open, 0),
          firstEpisodeId: open[0]?.episodeId ?? null,
        });
      })
      // 枠の表示を、これの失敗で止めない
      .catch(() => undefined);
  }, [location.pathname]);

  return { title, websiteUrl, review };
}

function useActiveSection(): "episodes" | "review" | "settings" {
  const { pathname } = useLocation();
  if (pathname.startsWith("/settings")) return "settings";
  if (/^\/episodes\/[^/]+\/review/.test(pathname)) return "review";
  return "episodes";
}

/**
 * 画面の枠。PC は上のナビ、スマホは下のタブ
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const { title, websiteUrl, review } = useShellData();
  const { mode, cycleTheme } = useTheme();
  const active = useActiveSection();

  // 確認待ちがあれば最初の回のカードへ、無ければ一覧へ
  const reviewTo = review.firstEpisodeId ? `/episodes/${review.firstEpisodeId}/review` : "/";

  return (
    <>
      <div className="brand-stripe" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <header className="topnav">
        <div className="topnav-inner">
          <div className="flex items-center gap-8 min-w-0">
            <Link to="/" className="flex items-baseline gap-2.5 min-w-0">
              <span className="text-base font-bold tracking-tight truncate">{title ?? "Imagecaster"}</span>
              <span className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">管理画面</span>
            </Link>

            <nav className="hidden md:flex items-center gap-6">
              <NavLink to="/" className={`topnav-link ${active === "episodes" ? "active" : ""}`}>
                <span>エピソード</span>
              </NavLink>
              <NavLink to={reviewTo} className={`topnav-link ${active === "review" ? "active" : ""}`}>
                <span>確認</span>
                {review.count > 0 && <span className="nav-count">{review.count}</span>}
              </NavLink>
              <NavLink to="/settings" className={`topnav-link ${active === "settings" ? "active" : ""}`}>
                <span>設定</span>
              </NavLink>
              {websiteUrl && (
                <a href={websiteUrl} target="_blank" rel="noopener noreferrer" className="topnav-link">
                  <span>サイト ↗</span>
                </a>
              )}
            </nav>
          </div>

          <div className="flex items-center gap-1 md:gap-4">
            <div className="hidden md:block">
              <BuildStatus />
            </div>
            {/* .topnav-link や .btn は display を持つので、出し分けは外側の箱で行う */}
            {websiteUrl && (
              <div className="md:hidden">
                <a
                  href={websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="topnav-link px-2 text-[13px]"
                >
                  <span>サイト ↗</span>
                </a>
              </div>
            )}
            <button
              type="button"
              onClick={cycleTheme}
              className="topnav-link px-2 text-[13px]"
              title="クリックでテーマを切り替え"
            >
              <span>{THEME_LABEL[mode]}</span>
            </button>
            <div className="hidden md:block">
              <Link to="/new" className="btn btn-primary text-sm">
                新しいエピソード
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="main-content">{children}</main>

      <nav className="bottom-tabs" aria-label="メニュー">
        <NavLink to="/" className={`bottom-tab ${active === "episodes" ? "active" : ""}`}>
          エピソード
        </NavLink>
        <NavLink to={reviewTo} className={`bottom-tab ${active === "review" ? "active" : ""}`}>
          <span>
            確認{review.count > 0 && <span className="nav-count ml-1">{review.count}</span>}
          </span>
        </NavLink>
        <NavLink to="/settings" className={`bottom-tab ${active === "settings" ? "active" : ""}`}>
          設定
        </NavLink>
      </nav>
    </>
  );
}
