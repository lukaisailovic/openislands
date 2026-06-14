import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { TablePlugin } from "@lexical/react/LexicalTablePlugin";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { TableCellNode, TableNode, TableRowNode } from "@lexical/table";
import { $getRoot, type EditorState } from "lexical";
import { useEffect, useImperativeHandle, useRef, type RefObject } from "react";
import { FloatingLinkPlugin } from "./FloatingLink.js";
import { EDITOR_TRANSFORMERS, editorToMarkdown, editorToMarkdownRaw, markdownToEditor } from "./markdown.js";
import { Toolbar } from "./Toolbar.js";
import type { EditorHandle } from "./types.js";

const EDITOR_NODES = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  CodeNode,
  CodeHighlightNode,
  LinkNode,
  AutoLinkNode,
  TableNode,
  TableCellNode,
  TableRowNode,
];

const THEME = {
  paragraph: "mb-3 leading-relaxed",
  quote: "my-3 border-l-2 border-kumo-hairline pl-4 text-kumo-subtle italic",
  heading: {
    h1: "mt-5 mb-3 text-2xl font-semibold text-kumo-strong",
    h2: "mt-5 mb-2.5 text-xl font-semibold text-kumo-strong",
    h3: "mt-4 mb-2 text-lg font-semibold text-kumo-strong",
    h4: "mt-4 mb-2 text-base font-semibold text-kumo-strong",
    h5: "mt-3 mb-1.5 text-sm font-semibold text-kumo-strong",
    h6: "mt-3 mb-1.5 text-sm font-semibold text-kumo-subtle",
  },
  list: {
    ul: "my-3 list-disc pl-6",
    ol: "my-3 list-decimal pl-6",
    listitem: "my-1",
    nested: { listitem: "list-none" },
  },
  link: "text-kumo-brand underline underline-offset-2 hover:text-kumo-brand-hover",
  text: {
    bold: "font-semibold",
    italic: "italic",
    code: "rounded bg-kumo-recessed px-1.5 py-0.5 font-mono text-[0.9em]",
    strikethrough: "line-through",
  },
  code: "my-3 block overflow-x-auto rounded-md bg-kumo-recessed px-4 py-3 font-mono text-[13px] leading-relaxed",
  table: "my-3 w-full table-fixed border-collapse text-sm",
  tableRow: "border-b border-kumo-hairline",
  tableCell: "border border-kumo-hairline px-3 py-1.5 align-top",
  tableCellHeader: "bg-kumo-recessed font-semibold text-kumo-strong",
};

/**
 * Load the document on mount and whenever the file changes underneath us — an
 * external edit or a restore. The echo of our own save is a no-op: when the
 * incoming content already matches the editor there's nothing to reload, so the
 * cursor never jumps. In-flight edits are safe because the parent only feeds new
 * content when the editor isn't dirty.
 */
function LoadFilePlugin({
  path,
  content,
  onLoaded,
}: {
  path: string;
  content: string;
  onLoaded: (markdown: string) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  useEffect(() => {
    let current = "";
    editor.getEditorState().read(() => {
      current = editorToMarkdown();
    });
    if (content === current) return;
    editor.update(
      () => {
        $getRoot().clear();
        markdownToEditor(content, $getRoot());
      },
      { discrete: true },
    );
    let serialized = "";
    editor.getEditorState().read(() => {
      serialized = editorToMarkdownRaw();
    });
    onLoadedRef.current(serialized);
  }, [editor, path, content]);
  return null;
}

/** Bridge an imperative `serialize()` to the parent through a ref. */
function SerializeBridge({ handleRef }: { handleRef: RefObject<EditorHandle | null> }) {
  const [editor] = useLexicalComposerContext();
  useImperativeHandle(
    handleRef,
    () => ({
      serialize: () => {
        let markdown = "";
        editor.getEditorState().read(() => {
          markdown = editorToMarkdown();
        });
        return markdown;
      },
    }),
    [editor],
  );
  return null;
}

/** Run `onSave` on Cmd/Ctrl-S without leaking the browser's Save dialog. */
function SaveShortcutPlugin({ onSave }: { onSave: () => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      onSave();
    };
    root.addEventListener("keydown", onKeyDown);
    return () => root.removeEventListener("keydown", onKeyDown);
  }, [editor, onSave]);
  return null;
}

export function EditorPane({
  path,
  content,
  readOnly,
  onSave,
  onDirtyChange,
  handleRef,
}: {
  path: string;
  content: string;
  readOnly: boolean;
  onSave: () => void;
  onDirtyChange: (dirty: boolean) => void;
  handleRef: RefObject<EditorHandle | null>;
}) {
  const baselineRef = useRef("");

  const initialConfig = {
    namespace: "content-editor",
    nodes: EDITOR_NODES,
    editable: !readOnly,
    editorState: null,
    theme: THEME,
    onError: (error: Error) => {
      throw error;
    },
  };

  const handleChange = (editorState: EditorState) => {
    editorState.read(() => {
      onDirtyChange(editorToMarkdownRaw() !== baselineRef.current);
    });
  };

  return (
    <LexicalComposer initialConfig={initialConfig}>
      {readOnly ? null : <Toolbar />}
      <div className="relative min-h-0 flex-1">
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              aria-label="Document editor"
              className="mx-auto min-h-full max-w-3xl px-8 py-6 text-[15px] text-kumo-default outline-none [&_*]:outline-none"
            />
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
      </div>
      <HistoryPlugin />
      <ListPlugin />
      <LinkPlugin />
      <FloatingLinkPlugin editable={!readOnly} />
      <TablePlugin />
      <MarkdownShortcutPlugin transformers={EDITOR_TRANSFORMERS} />
      <OnChangePlugin onChange={handleChange} ignoreSelectionChange />
      <SerializeBridge handleRef={handleRef} />
      <SaveShortcutPlugin onSave={onSave} />
      <LoadFilePlugin
        path={path}
        content={content}
        onLoaded={(markdown) => {
          baselineRef.current = markdown;
          onDirtyChange(false);
        }}
      />
    </LexicalComposer>
  );
}
