import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  type MultilineElementTransformer,
  TRANSFORMERS,
} from "@lexical/markdown";
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  TableCellHeaderStates,
  TableCellNode,
  TableNode,
  TableRowNode,
} from "@lexical/table";
import { $createParagraphNode, $createTextNode, $isParagraphNode, type ElementNode } from "lexical";

const TABLE_ROW = /^\|(.+)\|\s*$/;
const TABLE_DIVIDER_CELL = /^\s*:?-+:?\s*$/;

function splitRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/\|\s*$/, "");
  return inner.split("|").map((cell) => cell.trim());
}

function isTableRow(line: string): boolean {
  return TABLE_ROW.test(line.trim());
}

function isDividerRow(line: string): boolean {
  if (!isTableRow(line)) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => TABLE_DIVIDER_CELL.test(cell));
}

function cellText(cell: TableCellNode, traverseChildren: (node: ElementNode) => string): string {
  return traverseChildren(cell).trim().replace(/\n/g, " ").replace(/\|/g, "\\|");
}

/** Build a single table cell holding `text` run through the inline transformers. */
function createCell(text: string, isHeader: boolean): TableCellNode {
  const cell = $createTableCellNode(
    isHeader ? TableCellHeaderStates.ROW : TableCellHeaderStates.NO_STATUS,
  );
  const paragraph = $createParagraphNode();
  const container = $createParagraphNode();
  $convertFromMarkdownString(text.replace(/\\\|/g, "|"), TRANSFORMERS, container);
  const source = container.getFirstChild();
  if (source && $isParagraphNode(source)) {
    for (const child of source.getChildren()) paragraph.append(child);
  } else {
    paragraph.append($createTextNode(text));
  }
  cell.append(paragraph);
  return cell;
}

function buildTable(header: string[], body: string[][]): TableNode {
  const table = $createTableNode();
  const headerRow = $createTableRowNode();
  for (const text of header) headerRow.append(createCell(text, true));
  table.append(headerRow);
  for (const cells of body) {
    const row = $createTableRowNode();
    for (let i = 0; i < header.length; i++) row.append(createCell(cells[i] ?? "", false));
    table.append(row);
  }
  return table;
}

/**
 * A GFM pipe-table transformer so `content.editor` can offer table insert without
 * dropping data on save. `export` serializes a TableNode back to `| … |` rows with a
 * `---` header divider; import consumes the header, divider, and contiguous body rows
 * itself (a multiline transformer, not a sibling-peeking element one — table-only
 * documents have no siblings at match time). The pair round-trips: convertTo →
 * convertFrom → convertTo is stable.
 */
export const TABLE: MultilineElementTransformer = {
  type: "multiline-element",
  dependencies: [TableNode, TableRowNode, TableCellNode],
  export: (node, traverseChildren) => {
    if (!$isTableNode(node)) return null;
    const lines: string[] = [];
    node.getChildren().forEach((row, rowIndex) => {
      if (!$isTableRowNode(row)) return;
      const cells = row.getChildren().filter($isTableCellNode);
      lines.push(`| ${cells.map((cell) => cellText(cell, traverseChildren)).join(" | ")} |`);
      if (rowIndex === 0) lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
    });
    return lines.join("\n");
  },
  regExpStart: TABLE_ROW,
  regExpEnd: { optional: true, regExp: /$/ },
  handleImportAfterStartMatch: ({ lines, rootNode, startLineIndex, startMatch }) => {
    const dividerLine = lines[startLineIndex + 1];
    if (dividerLine === undefined || !isDividerRow(dividerLine)) return [false, startLineIndex];

    const header = splitRow(startMatch.input ?? lines[startLineIndex] ?? "");
    const body: string[][] = [];
    let lastIndex = startLineIndex + 1;
    for (let i = startLineIndex + 2; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined || !isTableRow(line) || isDividerRow(line)) break;
      body.push(splitRow(line));
      lastIndex = i;
    }
    rootNode.append(buildTable(header, body));
    return [true, lastIndex];
  },
  replace: () => false,
};

/** The full set the editor reads and writes: the defaults plus GFM tables, tables first. */
export const EDITOR_TRANSFORMERS = [TABLE, ...TRANSFORMERS];

export function markdownToEditor(markdown: string, root: ElementNode): void {
  $convertFromMarkdownString(markdown, EDITOR_TRANSFORMERS, root);
}

/**
 * The editor's content exactly as Lexical serializes it, with no trailing-newline
 * normalization. Use this for change detection: the normalization in
 * `editorToMarkdown` maps both "text" and "text\n" to "text\n", so a trailing
 * blank paragraph (pressing Enter at the end) would otherwise look unchanged.
 */
export function editorToMarkdownRaw(): string {
  return $convertToMarkdownString(EDITOR_TRANSFORMERS);
}

export function editorToMarkdown(): string {
  // End with a single trailing newline (POSIX/git convention); Lexical's serializer omits it,
  // which would otherwise strip the final newline from every file on save.
  const markdown = editorToMarkdownRaw();
  return markdown.endsWith("\n") ? markdown : `${markdown}\n`;
}
