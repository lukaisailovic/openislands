import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { TableCellNode, TableNode, TableRowNode } from "@lexical/table";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { $createParagraphNode, $getRoot, createEditor } from "lexical";
import type { RefObject } from "react";
import { describe, expect, it, vi } from "vitest";
import { AppIdContext } from "../src/client/useAppId.js";
import { CsvTable } from "../src/islands/editor/CsvTable.js";
import { parseCsv, serializeCsv } from "../src/islands/editor/csv.js";
import {
  groupDirPrefix,
  groupFiles,
  groupTargetPath,
  includeFilter,
  matchGlob,
  relativeToDir,
  UNGROUPED,
} from "../src/islands/editor/grouping.js";
import { editorToMarkdown, editorToMarkdownRaw, markdownToEditor } from "../src/islands/editor/markdown.js";
import type { EditorFile, EditorHandle } from "../src/islands/editor/types.js";
import { islandNeedsData, resolveRenderer } from "../src/islands/registry.js";
import { ContentEditor } from "../src/islands/ContentEditor.js";
import { loadLazyRenderer } from "./lazyRenderer.js";

function file(path: string, ext = "md"): EditorFile {
  const name = path.split("/").at(-1) ?? path;
  return { path, name, ext, size: 1, mtime: 0 };
}

describe("matchGlob", () => {
  it("matches * within a single segment but not across slashes", () => {
    expect(matchGlob("idea.md", "*.md")).toBe(true);
    expect(matchGlob("notes/idea.md", "*.md")).toBe(false);
    expect(matchGlob("draft.markdown", "*.md")).toBe(false);
  });

  it("matches ** across segments, including zero", () => {
    expect(matchGlob("idea.md", "**/*.md")).toBe(true);
    expect(matchGlob("a/b/idea.md", "**/*.md")).toBe(true);
    expect(matchGlob("a/b/c.md", "a/**/c.md")).toBe(true);
  });

  it("treats ? as a single non-slash character", () => {
    expect(matchGlob("a.md", "?.md")).toBe(true);
    expect(matchGlob("ab.md", "?.md")).toBe(false);
    expect(matchGlob("a/b.md", "?/?.md")).toBe(true);
  });

  it("anchors the whole path", () => {
    expect(matchGlob("meeting-notes.md", "meeting*")).toBe(true);
    expect(matchGlob("x-meeting.md", "meeting*")).toBe(false);
  });
});

describe("relativeToDir", () => {
  it("strips the dir prefix and tolerates a trailing slash", () => {
    expect(relativeToDir("data/docs/a.md", "data/docs")).toBe("a.md");
    expect(relativeToDir("data/docs/sub/a.md", "data/docs/")).toBe("sub/a.md");
    expect(relativeToDir("a.md", "")).toBe("a.md");
  });
});

describe("includeFilter", () => {
  const files = [file("d/a.md"), file("d/b.markdown", "markdown"), file("d/c.csv", "csv"), file("d/d.txt", "txt")];

  it("keeps markdown by default and drops other extensions", () => {
    const kept = includeFilter(files, undefined, "d", false).map((f) => f.name);
    expect(kept).toEqual(["a.md", "b.markdown"]);
  });

  it("adds csv when csv is enabled", () => {
    const kept = includeFilter(files, undefined, "d", true).map((f) => f.name);
    expect(kept).toEqual(["a.md", "b.markdown", "c.csv"]);
  });

  it("honors explicit include globs relative to dir", () => {
    const kept = includeFilter(files, ["*.txt"], "d", false).map((f) => f.name);
    expect(kept).toEqual(["d.txt"]);
  });
});

describe("groupFiles", () => {
  it("routes scattered files into the first matching group, rest to Ungrouped", () => {
    const files = [
      file("docs/meetings/jan.md"),
      file("docs/ideas/spark.md"),
      file("docs/meetings/feb.md"),
      file("docs/loose.md"),
    ];
    const groups = [
      { id: "meet", label: "Meetings", match: ["meetings/**"] },
      { id: "idea", label: "Ideas", icon: "lightbulb", match: ["ideas/**"] },
    ];
    const grouped = groupFiles(files, "docs", groups);
    expect(grouped.map((g) => g.group.id)).toEqual(["meet", "idea", "__ungrouped__"]);
    expect(grouped[0]!.files.map((f) => f.name)).toEqual(["jan.md", "feb.md"]);
    expect(grouped[1]!.files.map((f) => f.name)).toEqual(["spark.md"]);
    expect(grouped[2]!.files.map((f) => f.name)).toEqual(["loose.md"]);
  });

  it("assigns a file to the first group only", () => {
    const files = [file("d/x.md")];
    const groups = [
      { id: "a", match: ["*.md"] },
      { id: "b", match: ["x.md"] },
    ];
    const grouped = groupFiles(files, "d", groups);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.group.id).toBe("a");
  });

  it("drops empty groups and yields a single Ungrouped bucket without groups", () => {
    const grouped = groupFiles([file("d/a.md")], "d", undefined);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.group.id).toBe("__ungrouped__");
  });
});

describe("groupDirPrefix / groupTargetPath", () => {
  it("derives the folder from the first glob that names one", () => {
    expect(groupDirPrefix({ id: "s", match: ["specs/**", "architecture.md"] })).toBe("specs");
    expect(groupDirPrefix({ id: "r", match: ["runbooks/**", "incident-*.md"] })).toBe("runbooks");
    expect(groupDirPrefix({ id: "n", match: ["notes/sub/*.md"] })).toBe("notes/sub");
  });

  it("falls back to the dir root when no glob names a folder", () => {
    expect(groupDirPrefix({ id: "x", match: ["roadmap.md", "incident-*.md"] })).toBe("");
    expect(groupDirPrefix(UNGROUPED)).toBe("");
  });

  it("builds a create/move target under the group's folder, collapsing stray slashes", () => {
    const specs = { id: "s", match: ["specs/**"] };
    expect(groupTargetPath("data", specs, "idea.md")).toBe("data/specs/idea.md");
    expect(groupTargetPath("data", UNGROUPED, "idea.md")).toBe("data/idea.md");
    expect(groupTargetPath("data/docs/", specs, "idea.md")).toBe("data/docs/specs/idea.md");
  });
});

describe("parseCsv", () => {
  it("parses a simple table", () => {
    const { header, rows } = parseCsv("a,b,c\n1,2,3\n4,5,6");
    expect(header).toEqual(["a", "b", "c"]);
    expect(rows).toEqual([
      ["1", "2", "3"],
      ["4", "5", "6"],
    ]);
  });

  it("handles quoted fields with commas, newlines, and escaped quotes", () => {
    const { header, rows } = parseCsv('name,note\n"Doe, Jane","line1\nline2"\n"a ""quoted"" b",x');
    expect(header).toEqual(["name", "note"]);
    expect(rows[0]).toEqual(["Doe, Jane", "line1\nline2"]);
    expect(rows[1]).toEqual(['a "quoted" b', "x"]);
  });

  it("tolerates CRLF and a trailing newline without a blank row", () => {
    const { header, rows } = parseCsv("a,b\r\n1,2\r\n");
    expect(header).toEqual(["a", "b"]);
    expect(rows).toEqual([["1", "2"]]);
  });
});

describe("serializeCsv", () => {
  it("serializes a simple table with a trailing newline", () => {
    const csv = serializeCsv({ header: ["a", "b", "c"], rows: [["1", "2", "3"], ["4", "5", "6"]] });
    expect(csv).toBe("a,b,c\n1,2,3\n4,5,6\n");
  });

  it("quotes fields with commas, embedded quotes, or newlines and doubles inner quotes", () => {
    const csv = serializeCsv({
      header: ["name", "note"],
      rows: [["Doe, Jane", "line1\nline2"], ['a "quoted" b', "x"]],
    });
    expect(csv).toBe('name,note\n"Doe, Jane","line1\nline2"\n"a ""quoted"" b",x\n');
  });

  it("leaves empty fields unquoted", () => {
    expect(serializeCsv({ header: ["a", "b"], rows: [["", ""]] })).toBe("a,b\n,\n");
  });

  it("returns an empty string for empty input", () => {
    expect(serializeCsv({ header: [], rows: [] })).toBe("");
  });

  it("round-trips parse → serialize → parse and is idempotent under a second pass", () => {
    const texts = [
      "a,b,c\n1,2,3\n4,5,6",
      'name,note\n"Doe, Jane","line1\nline2"\n"a ""quoted"" b",x',
      "a,b\r\n1,2\r\n",
      "single\n",
      "x,y\n,\n",
    ];
    for (const text of texts) {
      const parsed = parseCsv(text);
      expect(parseCsv(serializeCsv(parsed))).toEqual(parsed);
      const normalized = serializeCsv(parsed);
      expect(serializeCsv(parseCsv(normalized))).toBe(normalized);
    }
  });
});

function renderGrid(props: {
  content: string;
  readOnly?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  handleRef?: RefObject<EditorHandle | null>;
}) {
  const handleRef = props.handleRef ?? ({ current: null } as RefObject<EditorHandle | null>);
  render(
    <CsvTable
      path="data/table.csv"
      content={props.content}
      readOnly={props.readOnly ?? false}
      onSave={() => {}}
      onDirtyChange={props.onDirtyChange ?? (() => {})}
      handleRef={handleRef}
    />,
  );
  return handleRef;
}

describe("CsvTable grid", () => {
  it("reflects a cell edit in serialize() and reports the document dirty", () => {
    const onDirtyChange = vi.fn();
    const ref = renderGrid({ content: "a,b\n1,2\n", onDirtyChange });

    const cell = screen.getByRole("textbox", { name: "a, row 1" });
    fireEvent.change(cell, { target: { value: "99" } });

    expect(ref.current!.serialize()).toBe("a,b\n99,2\n");
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it("appends an empty row when Add row is clicked", () => {
    const ref = renderGrid({ content: "a,b\n1,2\n" });

    fireEvent.click(screen.getByRole("button", { name: "Add row" }));

    expect(ref.current!.serialize()).toBe("a,b\n1,2\n,\n");
  });

  it("drops a row when its delete button is clicked", () => {
    const ref = renderGrid({ content: "a,b\n1,2\n3,4\n" });

    fireEvent.click(screen.getByRole("button", { name: "Delete row 1" }));

    expect(ref.current!.serialize()).toBe("a,b\n3,4\n");
  });

  it("renders no inputs when readOnly", () => {
    renderGrid({ content: "a,b\n1,2\n", readOnly: true });

    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.getByText("1")).toBeInTheDocument();
  });
});

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

function roundTrip(markdown: string): string {
  const editor = createEditor({ nodes: EDITOR_NODES, onError: (e) => { throw e; } });
  let imported = "";
  editor.update(
    () => {
      markdownToEditor(markdown, $getRoot());
    },
    { discrete: true },
  );
  editor.getEditorState().read(() => {
    imported = editorToMarkdown();
  });
  let reimported = "";
  const editor2 = createEditor({ nodes: EDITOR_NODES, onError: (e) => { throw e; } });
  editor2.update(
    () => {
      markdownToEditor(imported, $getRoot());
    },
    { discrete: true },
  );
  editor2.getEditorState().read(() => {
    reimported = editorToMarkdown();
  });
  expect(reimported).toBe(imported);
  return imported;
}

describe("markdown round-trip (no data loss on save)", () => {
  it("preserves headings, lists, quote, inline code, bold/italic, links, code blocks", () => {
    const md = [
      "# Title",
      "",
      "Some **bold** and *italic* and `code` and a [link](https://example.com).",
      "",
      "- one",
      "- two",
      "",
      "1. first",
      "2. second",
      "",
      "> a quote",
      "",
      "```js",
      "const x = 1;",
      "```",
    ].join("\n");
    expect(roundTrip(md)).toContain("# Title");
    expect(roundTrip(md)).toContain("**bold**");
    expect(roundTrip(md)).toContain("[link](https://example.com)");
    expect(roundTrip(md)).toContain("```");
  });

  it("preserves a GFM table across convertTo -> convertFrom -> convertTo", () => {
    const md = ["| Name | Role |", "| --- | --- |", "| Ada | Engineer |", "| Bob | Designer |"].join("\n");
    const out = roundTrip(md);
    expect(out).toContain("| Name | Role |");
    expect(out).toContain("| Ada | Engineer |");
    expect(out).toContain("| Bob | Designer |");
    expect(out).toMatch(/\| --- \| --- \|/);
  });

  it("preserves a table that is the only content in the document", () => {
    const md = ["| A | B |", "| --- | --- |", "| 1 | 2 |"].join("\n");
    const out = roundTrip(md);
    expect(out).toContain("| 1 | 2 |");
  });

  it("preserves inline formatting and links inside table cells", () => {
    const md = ["| Name | Link |", "| --- | --- |", "| **Bold** | [x](https://y.com) |"].join("\n");
    const out = roundTrip(md);
    expect(out).toContain("**Bold**");
    expect(out).toContain("[x](https://y.com)");
  });

  it("keeps a table embedded between prose and a list", () => {
    const md = ["# Title", "", "Intro.", "", "| A | B |", "| --- | --- |", "| 1 | 2 |", "", "- after"].join("\n");
    const out = roundTrip(md);
    expect(out).toContain("# Title");
    expect(out).toContain("| 1 | 2 |");
    expect(out).toContain("- after");
  });
});

describe("dirty detection (a trailing blank paragraph still counts as a change)", () => {
  it("sees an appended empty paragraph that normalized markdown hides", () => {
    const editor = createEditor({ nodes: EDITOR_NODES, onError: (e) => { throw e; } });
    editor.update(() => markdownToEditor("Hello", $getRoot()), { discrete: true });

    let rawBefore = "";
    let normBefore = "";
    editor.getEditorState().read(() => {
      rawBefore = editorToMarkdownRaw();
      normBefore = editorToMarkdown();
    });

    editor.update(() => $getRoot().append($createParagraphNode()), { discrete: true });

    let rawAfter = "";
    let normAfter = "";
    editor.getEditorState().read(() => {
      rawAfter = editorToMarkdownRaw();
      normAfter = editorToMarkdown();
    });

    // The normalized form (what we save) is identical — the old equality check missed the edit.
    expect(normAfter).toBe(normBefore);
    // The raw form (what dirty detection now compares) reflects the new blank paragraph.
    expect(rawAfter).not.toBe(rawBefore);
  });
});

describe("registry wiring", () => {
  it("resolves content.editor to the ContentEditor renderer", async () => {
    expect(await loadLazyRenderer(resolveRenderer("content.editor"))).toBe(ContentEditor);
  });

  it("marks content.editor as self-fetching (needs no dataset query)", () => {
    expect(islandNeedsData("content.editor")).toBe(false);
  });
});

describe("ContentEditor smoke render", () => {
  it("lists grouped files from the tree endpoint in the sidebar", async () => {
    const tree = {
      files: [
        { path: "data/docs/meetings/jan.md", name: "jan.md", ext: "md", size: 10, mtime: 1 },
        { path: "data/docs/notes/idea.md", name: "idea.md", ext: "md", size: 10, mtime: 1 },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (input.includes("/api/editor/tree")) {
          return new Response(JSON.stringify(tree), { status: 200 });
        }
        return new Response("", { status: 200 });
      }),
    );

    render(
      <AppIdContext.Provider value="kb">
        <ContentEditor
          config={{
            type: "content.editor",
            dir: "data/docs",
            groups: [{ id: "meet", label: "Meetings", match: ["meetings/**"] }],
          }}
        />
      </AppIdContext.Provider>,
    );

    expect(await screen.findByText("jan.md")).toBeInTheDocument();
    expect(screen.getByText("idea.md")).toBeInTheDocument();
    expect(screen.getByText("Meetings")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Ungrouped")).toBeInTheDocument());

    vi.unstubAllGlobals();
  });
});
