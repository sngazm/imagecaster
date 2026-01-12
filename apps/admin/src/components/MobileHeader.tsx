import { useMobileMenu } from "../contexts/MobileMenuContext";

export function MobileHeader() {
  const { toggle } = useMobileMenu();

  return (
    <header className="mobile-header">
      <button
        onClick={toggle}
        className="p-2 -ml-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        aria-label="メニューを開く"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-[var(--color-accent)] flex items-center justify-center">
          <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        </div>
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">
          Image Cast
        </span>
      </div>

      {/* 右側のスペーサー（中央揃え用） */}
      <div className="w-10" />
    </header>
  );
}
