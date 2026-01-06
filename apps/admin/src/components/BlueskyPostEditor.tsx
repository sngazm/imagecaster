import { useRef } from "react";

interface BlueskyPostEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

const PLACEHOLDERS = [
  { label: "タイトル", value: "{{TITLE}}" },
  { label: "エピソードURL", value: "{{EPISODE_URL}}" },
  { label: "音声URL", value: "{{AUDIO_URL}}" },
];

export function BlueskyPostEditor({
  value,
  onChange,
  disabled = false,
}: BlueskyPostEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insertPlaceholder = (placeholder: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newValue = value.slice(0, start) + placeholder + value.slice(end);
    onChange(newValue);

    // Set cursor position after the inserted placeholder
    requestAnimationFrame(() => {
      textarea.focus();
      const newPosition = start + placeholder.length;
      textarea.setSelectionRange(newPosition, newPosition);
    });
  };

  const copyPlaceholder = async (placeholder: string) => {
    try {
      await navigator.clipboard.writeText(placeholder);
    } catch {
      // Fallback if clipboard API fails
    }
  };

  const handlePlaceholderClick = (placeholder: string) => {
    // Try to insert at cursor position
    if (textareaRef.current && document.activeElement === textareaRef.current) {
      insertPlaceholder(placeholder);
    } else {
      // Focus and insert at the end
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.focus();
        const end = value.length;
        textarea.setSelectionRange(end, end);
        insertPlaceholder(placeholder);
      }
    }
  };

  return (
    <div className="space-y-2">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={"🎙️ 新エピソード公開！\n{{TITLE}}\n\n詳しくはこちら👇\n{{EPISODE_URL}}"}
        rows={5}
        disabled={disabled}
        className="w-full px-4 py-3 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] placeholder:text-[var(--color-text-faint)] focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-all disabled:opacity-50 font-mono text-sm"
      />
      <div className="flex flex-wrap gap-2">
        <span className="text-xs text-[var(--color-text-muted)] py-1">挿入:</span>
        {PLACEHOLDERS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => handlePlaceholderClick(p.value)}
            onContextMenu={(e) => {
              e.preventDefault();
              copyPlaceholder(p.value);
            }}
            disabled={disabled}
            className="inline-flex items-center gap-1 px-2 py-1 bg-[var(--color-bg-elevated)] hover:bg-sky-600/20 border border-[var(--color-border)] hover:border-sky-500/50 rounded text-xs text-sky-500 hover:text-sky-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            title={`クリックで挿入 / 右クリックでコピー`}
          >
            <code className="font-mono">{p.value}</code>
          </button>
        ))}
      </div>
      <p className="text-xs text-[var(--color-text-faint)]">
        タグをクリックするとカーソル位置に挿入されます
      </p>
    </div>
  );
}
