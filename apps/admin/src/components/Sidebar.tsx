import { NavLink, useLocation } from "react-router-dom";
import { BuildStatus } from "./BuildStatus";
import { useTheme, type ThemeMode } from "../hooks/useTheme";
import { useMobileMenu } from "../contexts/MobileMenuContext";

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  exact?: boolean;
}

// Theme icons and labels
const themeConfig: Record<ThemeMode, { icon: React.ReactNode; label: string }> = {
  light: {
    label: "ライト",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
      </svg>
    ),
  },
  dark: {
    label: "ダーク",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
      </svg>
    ),
  },
  system: {
    label: "自動",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
      </svg>
    ),
  },
};

const navItems: NavItem[] = [
  {
    to: "/",
    label: "エピソード",
    exact: true,
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
      </svg>
    ),
  },
  {
    to: "/settings",
    label: "設定",
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

export function Sidebar() {
  const location = useLocation();
  const { mode, cycleTheme } = useTheme();
  const { isOpen, close } = useMobileMenu();

  // 新規作成・詳細ページのときもエピソードをアクティブにする
  const isEpisodesActive = location.pathname === "/" ||
    location.pathname === "/new" ||
    location.pathname.startsWith("/episodes/");

  const currentTheme = themeConfig[mode];

  // ナビゲーション時にモバイルメニューを閉じる
  const handleNavClick = () => {
    close();
  };

  return (
    <>
      {/* オーバーレイ（モバイルのみ） */}
      <div
        className={`sidebar-overlay ${isOpen ? "open" : ""}`}
        onClick={close}
        aria-hidden="true"
      />

      {/* サイドバー */}
      <aside className={`sidebar ${isOpen ? "open" : ""}`}>
        {/* Logo / Brand */}
        <div className="px-4 py-5 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[var(--color-accent)] flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
                Image Cast
              </h1>
              <p className="text-xs text-[var(--color-text-muted)] truncate">
                管理画面
              </p>
            </div>
            {/* モバイル用閉じるボタン */}
            <button
              onClick={close}
              className="md:hidden p-2 -mr-2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
              aria-label="メニューを閉じる"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3 overflow-y-auto">
          <div className="space-y-1">
            {navItems.map((item) => {
              const isActive = item.exact
                ? isEpisodesActive && item.to === "/"
                : location.pathname === item.to;

              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={`sidebar-nav-item ${isActive ? "active" : ""}`}
                  onClick={handleNavClick}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </div>

          {/* New Episode Button */}
          <div className="px-2 mt-4">
            <NavLink
              to="/new"
              className="flex items-center justify-center gap-2 w-full px-3 py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white text-sm font-medium rounded-md transition-colors"
              onClick={handleNavClick}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              新規エピソード
            </NavLink>
          </div>
        </nav>

        {/* Footer */}
        <div className="border-t border-[var(--color-border)]">
          {/* Theme Switcher */}
          <div className="px-4 py-3 border-b border-[var(--color-border)]">
            <button
              onClick={cycleTheme}
              className="flex items-center justify-between w-full group"
              title="クリックでテーマを切り替え"
            >
              <span className="text-xs text-[var(--color-text-muted)]">テーマ</span>
              <span className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)] transition-colors">
                {currentTheme.icon}
                <span>{currentTheme.label}</span>
              </span>
            </button>
          </div>

          {/* Build Status */}
          <div className="px-4 py-3">
            <BuildStatus label="ビルド状況" />
          </div>
        </div>
      </aside>
    </>
  );
}
