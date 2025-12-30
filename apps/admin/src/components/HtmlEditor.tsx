import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { useState, useEffect, useCallback } from "react";

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

interface HtmlEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  onInsertPlaceholder?: (placeholder: string) => void;
}

const PLACEHOLDERS = [
  { label: "文字起こしURL", value: "{{TRANSCRIPT_URL}}" },
  { label: "エピソードURL", value: "{{EPISODE_URL}}" },
  { label: "音声URL", value: "{{AUDIO_URL}}" },
];

export function HtmlEditor({
  value,
  onChange,
  placeholder = "エピソードの説明を入力...",
}: HtmlEditorProps) {
  const [mode, setMode] = useState<"visual" | "html" | "preview">("visual");
  const [htmlSource, setHtmlSource] = useState(value);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "text-violet-400 underline",
        },
      }),
      Placeholder.configure({
        placeholder,
      }),
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
    setMode("html");
  };

  if (!editor) {
    return (
      <div className="h-48 bg-zinc-900 border border-zinc-800 rounded-lg animate-pulse" />
    );
  }

  return (
    <div className="border border-zinc-800 rounded-lg overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 p-2 bg-zinc-900 border-b border-zinc-800">
        {/* Mode switcher */}
        <div className="flex rounded-lg overflow-hidden border border-zinc-700 mr-2">
          <button
            type="button"
            onClick={() => setMode("visual")}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              mode === "visual"
                ? "bg-violet-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:text-white"
            }`}
          >
            ビジュアル
          </button>
          <button
            type="button"
            onClick={switchToHtmlMode}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              mode === "html"
                ? "bg-violet-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:text-white"
            }`}
          >
            HTML
          </button>
          <button
            type="button"
            onClick={() => setMode("preview")}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              mode === "preview"
                ? "bg-violet-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:text-white"
            }`}
          >
            プレビュー
          </button>
        </div>

        {mode === "visual" && (
          <>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={`p-2 rounded hover:bg-zinc-700 ${
                editor.isActive("bold") ? "bg-zinc-700 text-white" : "text-zinc-400"
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
              className={`p-2 rounded hover:bg-zinc-700 ${
                editor.isActive("italic") ? "bg-zinc-700 text-white" : "text-zinc-400"
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
              className={`p-2 rounded hover:bg-zinc-700 ${
                editor.isActive("link") ? "bg-zinc-700 text-white" : "text-zinc-400"
              }`}
              title="リンク (⌘K)"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" />
              </svg>
            </button>
            <div className="w-px h-6 bg-zinc-700 mx-1" />
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              className={`p-2 rounded hover:bg-zinc-700 ${
                editor.isActive("bulletList") ? "bg-zinc-700 text-white" : "text-zinc-400"
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
              className={`p-2 rounded hover:bg-zinc-700 ${
                editor.isActive("orderedList") ? "bg-zinc-700 text-white" : "text-zinc-400"
              }`}
              title="番号付きリスト"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M2 17h2v.5H3v1h1v.5H2v1h3v-4H2v1zm1-9h1V4H2v1h1v3zm-1 3h1.8L2 13.1v.9h3v-1H3.2L5 10.9V10H2v1zm5-6v2h14V5H7zm0 14h14v-2H7v2zm0-6h14v-2H7v2z" />
              </svg>
            </button>
          </>
        )}

        {/* Placeholders dropdown */}
        <div className="ml-auto relative group">
          <button
            type="button"
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-white bg-zinc-800 rounded-lg hover:bg-zinc-700 transition-colors"
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
          <div className="absolute right-0 mt-1 w-48 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
            {PLACEHOLDERS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => insertPlaceholder(p.value)}
                className="w-full px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-700 first:rounded-t-lg last:rounded-b-lg"
              >
                <span className="font-medium">{p.label}</span>
                <span className="block text-xs text-zinc-500 font-mono">
                  {p.value}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Editor content */}
      <div className="bg-zinc-950">
        {mode === "visual" && (
          <EditorContent
            editor={editor}
            className="prose prose-invert prose-sm max-w-none p-4 min-h-[200px] focus:outline-none [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[168px] [&_.ProseMirror_p.is-editor-empty:first-child::before]:text-zinc-600 [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none [&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0"
          />
        )}
        {mode === "html" && (
          <textarea
            value={htmlSource}
            onChange={(e) => handleHtmlChange(e.target.value)}
            className="w-full min-h-[200px] p-4 bg-transparent text-zinc-100 font-mono text-sm resize-y focus:outline-none"
            spellCheck={false}
          />
        )}
        {mode === "preview" && (
          <div
            className="prose prose-invert prose-sm max-w-none p-4 min-h-[200px]"
            dangerouslySetInnerHTML={{ __html: htmlSource }}
          />
        )}
      </div>
    </div>
  );
}
