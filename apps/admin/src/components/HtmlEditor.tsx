import { useEditor, EditorContent, Extension } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { useState, useEffect, useCallback, useMemo } from "react";

// プレースホルダータグをハイライト表示する拡張
const PlaceholderHighlight = Extension.create({
  name: "placeholderHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("placeholderHighlight"),
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            const doc = state.doc;

            doc.descendants((node, pos) => {
              if (node.isText && node.text) {
                const regex = /\{\{[A-Z_]+\}\}/g;
                let match;
                while ((match = regex.exec(node.text)) !== null) {
                  decorations.push(
                    Decoration.inline(
                      pos + match.index,
                      pos + match.index + match[0].length,
                      {
                        class: "placeholder-tag",
                      }
                    )
                  );
                }
              }
            });

            return DecorationSet.create(doc, decorations);
          },
        },
      }),
    ];
  },
});

// HTML整形ユーティリティ: インデントと改行を追加
function formatHtml(html: string): string {
  if (!html) return "";

  // 既に整形済みの場合はそのまま返す
  if (html.includes("\n  ")) return html;

  let formatted = html;

  // 閉じタグの前に改行を追加
  formatted = formatted.replace(/(<\/(?:p|div|ul|ol|li|h[1-6]|blockquote|pre|table|tr|td|th|thead|tbody|section|article|header|footer|nav|aside)>)/gi, "$1\n");

  // 開始タグの後に改行を追加（ブロック要素のみ）
  formatted = formatted.replace(/(<(?:p|div|ul|ol|li|h[1-6]|blockquote|pre|table|tr|thead|tbody|section|article|header|footer|nav|aside)[^>]*>)/gi, "\n$1");

  // 連続した改行を1つにまとめる
  formatted = formatted.replace(/\n{3,}/g, "\n\n");

  // 先頭と末尾の空白を削除
  formatted = formatted.trim();

  // インデントを追加
  const lines = formatted.split("\n");
  let indentLevel = 0;
  const indentedLines = lines.map((line) => {
    const trimmedLine = line.trim();
    if (!trimmedLine) return "";

    // 閉じタグの場合はインデントを減らす（先に）
    if (/^<\//.test(trimmedLine)) {
      indentLevel = Math.max(0, indentLevel - 1);
    }

    const indentedLine = "  ".repeat(indentLevel) + trimmedLine;

    // 開始タグで閉じタグがない場合はインデントを増やす
    if (/<(?:ul|ol|li|div|section|article|header|footer|nav|aside|blockquote|table|thead|tbody|tr)(?:\s[^>]*)?>/.test(trimmedLine) &&
        !/<\//.test(trimmedLine)) {
      indentLevel++;
    }

    return indentedLine;
  });

  return indentedLines.filter(line => line !== "").join("\n");
}

/** プレビュー用のエピソードコンテキスト */
export interface PreviewContext {
  slug?: string;
  id?: string;
  audioUrl?: string;
  sourceAudioUrl?: string | null;
  transcriptUrl?: string | null;
  referenceLinks?: { url: string; title: string }[];
  websiteUrl?: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatReferenceLinks(links: { url: string; title: string }[]): string {
  if (!links || links.length === 0) return "";
  return links
    .map(
      (link) =>
        `<p>${escapeHtml(link.title)}<br><a href="${escapeHtml(link.url)}">${escapeHtml(link.url)}</a></p>`
    )
    .join("\n");
}

function replacePlaceholders(html: string, ctx: PreviewContext): string {
  const slug = ctx.slug || ctx.id || "";
  const websiteUrl = ctx.websiteUrl || "";
  const episodePageUrl = slug ? `${websiteUrl}/episodes/${slug}` : "";
  const transcriptPageUrl = ctx.transcriptUrl && slug
    ? `${websiteUrl}/episodes/${slug}/transcript`
    : "";
  const audioUrl = ctx.audioUrl || ctx.sourceAudioUrl || "";

  let result = html
    .replace(/\{\{TRANSCRIPT_URL\}\}/g, transcriptPageUrl)
    .replace(/\{\{EPISODE_URL\}\}/g, episodePageUrl)
    .replace(/\{\{AUDIO_URL\}\}/g, audioUrl);

  if (ctx.referenceLinks && ctx.referenceLinks.length > 0) {
    result = result.replace(
      /\{\{REFERENCE_LINKS\}\}/g,
      formatReferenceLinks(ctx.referenceLinks)
    );
  } else {
    result = result.replace(/<p>\s*\{\{REFERENCE_LINKS\}\}\s*<\/p>\s*/gi, "");
    result = result.replace(/<div>\s*\{\{REFERENCE_LINKS\}\}\s*<\/div>\s*/gi, "");
    result = result.replace(/\{\{REFERENCE_LINKS\}\}/g, "");
  }

  return result;
}

interface HtmlEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  onInsertPlaceholder?: (placeholder: string) => void;
  /** プレビューモードで使用するエピソードコンテキスト */
  previewContext?: PreviewContext;
}

const PLACEHOLDERS = [
  { label: "文字起こしURL", value: "{{TRANSCRIPT_URL}}" },
  { label: "エピソードURL", value: "{{EPISODE_URL}}" },
  { label: "音声URL", value: "{{AUDIO_URL}}" },
  { label: "参考リンク", value: "{{REFERENCE_LINKS}}" },
];

export function HtmlEditor({
  value,
  onChange,
  placeholder = "エピソードの説明を入力...",
  previewContext,
}: HtmlEditorProps) {
  const [mode, setMode] = useState<"visual" | "html">("visual");
  const [htmlPreview, setHtmlPreview] = useState(false);
  const hasPlaceholders = /\{\{[A-Z_]+\}\}/.test(value);
  const [htmlSource, setHtmlSource] = useState(value);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: {
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          defaultProtocol: "https",
          HTMLAttributes: {
            class: "text-[var(--color-accent)] underline",
          },
        },
      }),
      Placeholder.configure({
        placeholder,
      }),
      PlaceholderHighlight,
    ],
    content: value,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onChange(html);
      setHtmlSource(html);
    },
  });

  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value);
      setHtmlSource(value);
    }
  }, [value, editor]);

  const insertPlaceholder = useCallback(
    (placeholder: string) => {
      if (mode === "visual" && editor) {
        editor.chain().focus().insertContent(placeholder).run();
      } else if (mode === "html") {
        setHtmlSource((prev) => prev + placeholder);
        onChange(htmlSource + placeholder);
      }
    },
    [editor, mode, htmlSource, onChange]
  );

  const handleHtmlChange = (newHtml: string) => {
    setHtmlSource(newHtml);
    onChange(newHtml);
    if (editor) {
      editor.commands.setContent(newHtml);
    }
  };

  const setLink = useCallback(() => {
    if (!editor) return;
    const previousUrl = editor.getAttributes("link").href;
    const url = window.prompt("URL", previousUrl);

    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }

    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, [editor]);

  // macOS: Cmd+K、Windows/Linux: Ctrl+K でリンク設定
  // macOS では Ctrl+K が行末削除のemacsキーバインドと競合するため Cmd+K のみ
  useEffect(() => {
    if (!editor) return;

    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

    const handleKeyDown = (e: KeyboardEvent) => {
      // エディタにフォーカスがない場合は何もしない
      if (!editor.isFocused) return;

      // macOS: Cmd+K のみ、Ctrl+K は無視（行末削除のため）
      // Windows/Linux: Ctrl+K
      if (e.key === "k") {
        if (isMac) {
          if (e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            setLink();
          }
          // Ctrl+K は何もしない（行末削除をOSに任せる）
        } else {
          if (e.ctrlKey) {
            e.preventDefault();
            setLink();
          }
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [editor, setLink]);

  // HTMLモードに切り替えた時に整形
  const switchToHtmlMode = () => {
    const formattedHtml = formatHtml(htmlSource);
    setHtmlSource(formattedHtml);
    setHtmlPreview(false);
    setMode("html");
  };

  // プレビュー用のHTMLソース（プレースホルダーを置換 + 整形済み）
  const previewHtmlSource = useMemo(() => {
    if (!previewContext) return formatHtml(value);
    return formatHtml(replacePlaceholders(value, previewContext));
  }, [value, previewContext]);

  if (!editor) {
    return (
      <div className="h-48 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-lg animate-pulse" />
    );
  }

  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 p-2 bg-[var(--color-bg-elevated)] border-b border-[var(--color-border)]">
        {/* Mode switcher */}
        <div className="flex rounded-lg overflow-hidden border border-[var(--color-border)] mr-2">
          <button
            type="button"
            onClick={() => setMode("visual")}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              mode === "visual"
                ? "bg-[var(--color-accent)] text-white"
                : "bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            ビジュアル
          </button>
          <button
            type="button"
            onClick={switchToHtmlMode}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              mode === "html"
                ? "bg-[var(--color-accent)] text-white"
                : "bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            HTML
          </button>
        </div>

        {mode === "visual" && (
          <>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={`p-2 rounded hover:bg-[var(--color-bg-hover)] ${
                editor.isActive("bold") ? "bg-[var(--color-bg-hover)] text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)]"
              }`}
              title="太字"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className={`p-2 rounded hover:bg-[var(--color-bg-hover)] ${
                editor.isActive("italic") ? "bg-[var(--color-bg-hover)] text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)]"
              }`}
              title="斜体"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={setLink}
              className={`p-2 rounded hover:bg-[var(--color-bg-hover)] ${
                editor.isActive("link") ? "bg-[var(--color-bg-hover)] text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)]"
              }`}
              title="リンク (⌘K)"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" />
              </svg>
            </button>
            <div className="w-px h-6 bg-[var(--color-border)] mx-1" />
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              className={`p-2 rounded hover:bg-[var(--color-bg-hover)] ${
                editor.isActive("bulletList") ? "bg-[var(--color-bg-hover)] text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)]"
              }`}
              title="箇条書き"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M4 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5zm0-6c-.83 0-1.5.67-1.5 1.5S3.17 7.5 4 7.5 5.5 6.83 5.5 6 4.83 4.5 4 4.5zm0 12c-.83 0-1.5.68-1.5 1.5s.68 1.5 1.5 1.5 1.5-.68 1.5-1.5-.67-1.5-1.5-1.5zM7 19h14v-2H7v2zm0-6h14v-2H7v2zm0-8v2h14V5H7z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              className={`p-2 rounded hover:bg-[var(--color-bg-hover)] ${
                editor.isActive("orderedList") ? "bg-[var(--color-bg-hover)] text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)]"
              }`}
              title="番号付きリスト"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M2 17h2v.5H3v1h1v.5H2v1h3v-4H2v1zm1-9h1V4H2v1h1v3zm-1 3h1.8L2 13.1v.9h3v-1H3.2L5 10.9V10H2v1zm5-6v2h14V5H7zm0 14h14v-2H7v2zm0-6h14v-2H7v2z" />
              </svg>
            </button>
          </>
        )}

        {/* HTML preview toggle */}
        {mode === "html" && previewContext && hasPlaceholders && (
          <button
            type="button"
            onClick={() => setHtmlPreview(!htmlPreview)}
            className={`ml-auto px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              htmlPreview
                ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)] border border-[var(--color-accent)]/30"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-hover)]"
            }`}
          >
            タグ展開
          </button>
        )}

        {/* Placeholders dropdown */}
        {!(mode === "html" && htmlPreview) && <div className={`${mode !== "html" || !previewContext || !hasPlaceholders ? "ml-auto" : ""} relative group`}>
          <button
            type="button"
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] bg-[var(--color-bg-elevated)] rounded-lg hover:bg-[var(--color-bg-hover)] transition-colors"
          >
            タグを挿入
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          <div className="absolute right-0 mt-1 w-48 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
            {PLACEHOLDERS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => insertPlaceholder(p.value)}
                className="w-full px-3 py-2 text-left text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] first:rounded-t-lg last:rounded-b-lg"
              >
                <span className="font-medium">{p.label}</span>
                <span className="block text-xs text-[var(--color-text-muted)] font-mono">
                  {p.value}
                </span>
              </button>
            ))}
          </div>
        </div>}
      </div>

      {/* Editor content */}
      <div className="bg-[var(--color-bg-base)] max-h-[calc(100vh-200px)] overflow-y-auto">
        {mode === "visual" && (
          <EditorContent
            editor={editor}
            className="prose prose-sm max-w-none p-4 min-h-[200px] focus:outline-none [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[168px] [&_.ProseMirror_p.is-editor-empty:first-child::before]:text-[var(--color-text-faint)] [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none [&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0 [&_.placeholder-tag]:bg-[var(--color-accent)]/30 [&_.placeholder-tag]:text-[var(--color-accent)] [&_.placeholder-tag]:px-1.5 [&_.placeholder-tag]:py-0.5 [&_.placeholder-tag]:rounded [&_.placeholder-tag]:font-mono [&_.placeholder-tag]:text-xs [&_.placeholder-tag]:border [&_.placeholder-tag]:border-[var(--color-accent)]/50"
          />
        )}
        {mode === "html" && (
          htmlPreview && previewContext ? (
            <textarea
              value={previewHtmlSource}
              readOnly
              className="w-full min-h-[200px] max-h-none p-4 bg-transparent text-[var(--color-text-primary)] font-mono text-sm resize-none focus:outline-none opacity-75"
              spellCheck={false}
            />
          ) : (
            <textarea
              value={htmlSource}
              onChange={(e) => handleHtmlChange(e.target.value)}
              className="w-full min-h-[200px] max-h-none p-4 bg-transparent text-[var(--color-text-primary)] font-mono text-sm resize-none focus:outline-none"
              spellCheck={false}
            />
          )
        )}
      </div>
    </div>
  );
}
