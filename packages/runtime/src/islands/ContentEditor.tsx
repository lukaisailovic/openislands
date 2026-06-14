import { Button, Text } from "@cloudflare/kumo";
import {
  ClockCounterClockwise,
  FilePlus,
  FloppyDisk,
  Notebook,
  TrashSimple,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppId } from "../client/useAppId.js";
import type { IslandRenderProps } from "../types.js";
import {
  createFile,
  deleteFile,
  editorTree,
  readFile,
  writeFile,
} from "./editor/api.js";
import { CsvTable } from "./editor/CsvTable.js";
import { DeleteFileDialog, NewFileDialog } from "./editor/dialogs.js";
import { EditorPane } from "./editor/EditorPane.js";
import { FileTree } from "./editor/FileTree.js";
import { HistoryPanel } from "./editor/HistoryPanel.js";
import { includeFilter } from "./editor/grouping.js";
import type { ContentEditorConfig, EditorFile, EditorHandle } from "./editor/types.js";

function basename(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function isCsv(path: string): boolean {
  return path.toLowerCase().endsWith(".csv");
}

/** A document open in the editor: its path and the content read for it. */
interface OpenDoc {
  path: string;
  content: string;
}

function Placeholder() {
  return (
    <div className="flex h-[calc(100vh-9rem)] min-h-[32rem] items-center justify-center rounded-lg border border-kumo-hairline bg-kumo-base">
      <Text variant="secondary" size="sm">
        Loading editor…
      </Text>
    </div>
  );
}

export function ContentEditor({ config }: IslandRenderProps) {
  const cfg = config as ContentEditorConfig;
  const appId = useAppId();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const singleFile = cfg.file;
  const dir = cfg.dir ?? "";
  const readOnly = cfg.readOnly === true;

  const [files, setFiles] = useState<EditorFile[]>([]);
  const [activePath, setActivePath] = useState<string | null>(singleFile ?? null);
  const [doc, setDoc] = useState<OpenDoc | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const editorRef = useRef<EditorHandle | null>(null);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const activePathRef = useRef(activePath);
  activePathRef.current = activePath;

  const visibleFiles = useMemo(
    () => includeFilter(files, cfg.include, dir, cfg.csv === true),
    [files, cfg.include, dir, cfg.csv],
  );

  const refreshTree = useCallback(async () => {
    if (singleFile) return;
    const next = await editorTree(appId, dir);
    setFiles(next);
  }, [appId, dir, singleFile]);

  const openFile = useCallback(
    async (path: string) => {
      setActivePath(path);
      const content = await readFile(appId, path);
      setDoc({ path, content });
    },
    [appId],
  );

  useEffect(() => {
    if (!mounted) return;
    if (singleFile) {
      void openFile(singleFile);
      return;
    }
    void refreshTree();
  }, [mounted, singleFile, openFile, refreshTree]);

  // First load (or a tree refresh) with nothing open yet: open the first file.
  useEffect(() => {
    if (singleFile || activePath !== null || visibleFiles.length === 0) return;
    void openFile(visibleFiles[0]!.path);
  }, [singleFile, activePath, visibleFiles, openFile]);

  useEffect(() => {
    if (!mounted || typeof EventSource === "undefined") return;
    const source = new EventSource(`/api/events?app=${encodeURIComponent(appId)}`);
    const onFiles = (event: MessageEvent) => {
      const paths = (JSON.parse(event.data) as { paths?: string[] }).paths ?? [];
      if (!singleFile) void refreshTree();
      const current = activePathRef.current;
      if (current && paths.includes(current) && !dirtyRef.current) {
        void readFile(appId, current).then((content) => setDoc({ path: current, content }));
      }
    };
    source.addEventListener("files-changed", onFiles as EventListener);
    return () => source.close();
  }, [mounted, appId, singleFile, refreshTree]);

  const handleSave = useCallback(async () => {
    const handle = editorRef.current;
    if (!handle || !activePath || readOnly) return;
    setSaving(true);
    try {
      const content = handle.serialize();
      await writeFile(appId, activePath, content);
      setDoc({ path: activePath, content });
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }, [appId, activePath, readOnly]);

  const handleCreate = useCallback(
    async (path: string) => {
      await createFile(appId, path);
      await refreshTree();
      await openFile(path);
    },
    [appId, refreshTree, openFile],
  );

  const handleDelete = useCallback(async () => {
    if (!activePath) return;
    await deleteFile(appId, activePath);
    setActivePath(null);
    setDoc(null);
    await refreshTree();
  }, [appId, activePath, refreshTree]);

  if (!mounted) return <Placeholder />;

  const canEdit = !readOnly && activePath !== null;

  return (
    <div className="flex h-[calc(100vh-9rem)] min-h-[32rem] overflow-hidden rounded-lg border border-kumo-hairline bg-kumo-base">
      {singleFile ? null : (
        <aside className="flex w-64 shrink-0 flex-col border-r border-kumo-hairline bg-kumo-recessed/30">
          <div className="flex items-center justify-between gap-2 border-b border-kumo-hairline px-3 py-2">
            <Text size="xs" DANGEROUS_className="font-medium text-kumo-subtle uppercase tracking-wide">
              {cfg.title ?? "Files"}
            </Text>
            {readOnly ? null : (
              <Button
                variant="ghost"
                size="sm"
                shape="square"
                aria-label="New note"
                title="New note"
                onClick={() => setNewOpen(true)}
              >
                <FilePlus size={15} />
              </Button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <FileTree
              files={visibleFiles}
              dir={dir}
              groups={cfg.groups}
              activePath={activePath}
              onSelect={(path) => void openFile(path)}
            />
          </div>
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-kumo-hairline px-4 py-2">
          <Notebook size={16} className="flex-none text-kumo-subtle" />
          <Text size="sm" DANGEROUS_className="min-w-0 flex-1 truncate font-medium text-kumo-strong">
            {activePath ? basename(activePath) : "No file selected"}
          </Text>
          {dirty ? (
            <span
              className="size-1.5 flex-none rounded-full bg-kumo-warning"
              aria-label="Unsaved changes"
              title="Unsaved changes"
            />
          ) : null}
          {activePath ? (
            <Button
              variant="ghost"
              size="sm"
              icon={ClockCounterClockwise}
              onClick={() => setHistoryOpen(true)}
            >
              History
            </Button>
          ) : null}
          {readOnly ? null : (
            <Button
              variant="ghost"
              size="sm"
              shape="square"
              aria-label="Delete note"
              title="Delete note"
              disabled={!activePath || Boolean(singleFile)}
              onClick={() => setDeleteOpen(true)}
            >
              <TrashSimple size={15} />
            </Button>
          )}
          {readOnly ? null : (
            <Button
              variant="primary"
              size="sm"
              icon={FloppyDisk}
              loading={saving}
              disabled={!canEdit || !dirty}
              onClick={() => void handleSave()}
            >
              Save
            </Button>
          )}
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          {doc ? (
            isCsv(doc.path) ? (
              <CsvTable
                key={doc.path}
                path={doc.path}
                content={doc.content}
                readOnly={readOnly}
                onSave={() => void handleSave()}
                onDirtyChange={setDirty}
                handleRef={editorRef}
              />
            ) : (
              <EditorPane
                key={doc.path}
                path={doc.path}
                content={doc.content}
                readOnly={readOnly}
                onSave={() => void handleSave()}
                onDirtyChange={setDirty}
                handleRef={editorRef}
              />
            )
          ) : (
            <div className="flex h-full items-center justify-center">
              <Text variant="secondary" size="sm">
                {visibleFiles.length === 0 && !singleFile
                  ? "No documents here yet."
                  : "Select a file to start editing."}
              </Text>
            </div>
          )}
        </main>
      </div>

      {activePath ? (
        <HistoryPanel
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          path={activePath}
          onRestored={() => void openFile(activePath)}
        />
      ) : null}
      {singleFile ? null : (
        <NewFileDialog open={newOpen} onOpenChange={setNewOpen} dir={dir} onCreate={handleCreate} />
      )}
      {activePath && !singleFile ? (
        <DeleteFileDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          path={activePath}
          onDelete={handleDelete}
        />
      ) : null}
    </div>
  );
}
