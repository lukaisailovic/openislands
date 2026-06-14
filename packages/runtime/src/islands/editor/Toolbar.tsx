import { $createCodeNode } from "@lexical/code";
import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import {
  $isListNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListNode,
  REMOVE_LIST_COMMAND,
} from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createHeadingNode, $createQuoteNode, $isHeadingNode } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import { INSERT_TABLE_COMMAND } from "@lexical/table";
import { $findMatchingParent, $getNearestNodeOfType, mergeRegister } from "@lexical/utils";
import { Button, Tooltip, cn } from "@cloudflare/kumo";
import {
  Code,
  CodeBlock,
  type Icon,
  ListBullets,
  ListNumbers,
  Link as LinkIcon,
  Quotes,
  Table as TableIcon,
  TextB,
  TextHOne,
  TextHThree,
  TextHTwo,
  TextItalic,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  type ElementNode,
  FORMAT_TEXT_COMMAND,
  SELECTION_CHANGE_COMMAND,
} from "lexical";

/** The current selection's block kind, used to highlight the matching toolbar button. */
type BlockType = "paragraph" | "h1" | "h2" | "h3" | "quote" | "code" | "bullet" | "number" | null;

interface SelectionState {
  block: BlockType;
  bold: boolean;
  italic: boolean;
  code: boolean;
  link: boolean;
}

const EMPTY: SelectionState = {
  block: "paragraph",
  bold: false,
  italic: false,
  code: false,
  link: false,
};

function readSelection(): SelectionState {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return EMPTY;

  const anchorNode = selection.anchor.getNode();
  const topLevel = $findMatchingParent(anchorNode, (node) => {
    const parent = node.getParent();
    return parent !== null && parent.getKey() === "root";
  });
  const element = topLevel ?? anchorNode;

  let block: BlockType = "paragraph";
  if ($isListNode(element)) {
    const listNode = $getNearestNodeOfType(anchorNode, ListNode) ?? element;
    block = listNode.getListType() === "number" ? "number" : "bullet";
  } else if ($isHeadingNode(element)) {
    const tag = element.getTag();
    block = tag === "h1" || tag === "h2" || tag === "h3" ? tag : "paragraph";
  } else {
    const type = element.getType();
    if (type === "quote") block = "quote";
    else if (type === "code") block = "code";
  }

  const linkNode = $findMatchingParent(anchorNode, $isLinkNode);
  return {
    block,
    bold: selection.hasFormat("bold"),
    italic: selection.hasFormat("italic"),
    code: selection.hasFormat("code"),
    link: linkNode !== null,
  };
}

function ToolButton({
  label,
  glyph: Glyph,
  active,
  onClick,
}: {
  label: string;
  glyph: Icon;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip
      content={label}
      render={
        <Button
          variant="ghost"
          size="sm"
          shape="square"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={cn(active && "bg-kumo-tint text-kumo-strong")}
        >
          <Glyph size={16} />
        </Button>
      }
    />
  );
}

const DIVIDER = <span className="mx-1 h-5 w-px bg-kumo-hairline" aria-hidden />;

export function Toolbar() {
  const [editor] = useLexicalComposerContext();
  const [state, setState] = useState<SelectionState>(EMPTY);

  const refresh = useCallback(() => {
    editor.getEditorState().read(() => setState(readSelection()));
  }, [editor]);

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => editorState.read(() => setState(readSelection()))),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          refresh();
          return false;
        },
        1,
      ),
    );
  }, [editor, refresh]);

  const toBlock = (create: () => ElementNode) => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) $setBlocksType(selection, create);
    });
  };

  const toggleHeading = (tag: "h1" | "h2" | "h3") =>
    toBlock(() => (state.block === tag ? $createParagraphNode() : $createHeadingNode(tag)));

  const toggleQuote = () =>
    toBlock(() => (state.block === "quote" ? $createParagraphNode() : $createQuoteNode()));

  const toggleCodeBlock = () =>
    toBlock(() => (state.block === "code" ? $createParagraphNode() : $createCodeNode()));

  const toggleList = (type: "bullet" | "number") => {
    if (state.block === type) {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
      return;
    }
    const command = type === "bullet" ? INSERT_UNORDERED_LIST_COMMAND : INSERT_ORDERED_LIST_COMMAND;
    editor.dispatchCommand(command, undefined);
  };

  const toggleLink = () => {
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, state.link ? null : "https://");
  };

  const insertTable = () => {
    editor.dispatchCommand(INSERT_TABLE_COMMAND, { columns: "3", rows: "3", includeHeaders: true });
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-kumo-hairline px-2 py-1.5">
      <ToolButton
        label="Bold"
        glyph={TextB}
        active={state.bold}
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")}
      />
      <ToolButton
        label="Italic"
        glyph={TextItalic}
        active={state.italic}
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")}
      />
      <ToolButton
        label="Inline code"
        glyph={Code}
        active={state.code}
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "code")}
      />
      {DIVIDER}
      <ToolButton label="Heading 1" glyph={TextHOne} active={state.block === "h1"} onClick={() => toggleHeading("h1")} />
      <ToolButton label="Heading 2" glyph={TextHTwo} active={state.block === "h2"} onClick={() => toggleHeading("h2")} />
      <ToolButton
        label="Heading 3"
        glyph={TextHThree}
        active={state.block === "h3"}
        onClick={() => toggleHeading("h3")}
      />
      {DIVIDER}
      <ToolButton
        label="Bulleted list"
        glyph={ListBullets}
        active={state.block === "bullet"}
        onClick={() => toggleList("bullet")}
      />
      <ToolButton
        label="Numbered list"
        glyph={ListNumbers}
        active={state.block === "number"}
        onClick={() => toggleList("number")}
      />
      <ToolButton label="Quote" glyph={Quotes} active={state.block === "quote"} onClick={toggleQuote} />
      <ToolButton label="Code block" glyph={CodeBlock} active={state.block === "code"} onClick={toggleCodeBlock} />
      {DIVIDER}
      <ToolButton label="Link" glyph={LinkIcon} active={state.link} onClick={toggleLink} />
      <ToolButton label="Insert table" glyph={TableIcon} onClick={insertTable} />
    </div>
  );
}
