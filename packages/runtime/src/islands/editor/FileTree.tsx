import { Button, Collapsible, Popover, Text, cn } from "@cloudflare/kumo";
import { CaretRight, DotsThreeVertical, FileCsv, FileText, type Icon } from "@phosphor-icons/react";
import { useState } from "react";
import { pageIcon } from "../../components/pageIcons.js";
import { groupFiles, groupTargetPath, UNGROUPED } from "./grouping.js";
import type { EditorFile, EditorGroup } from "./types.js";

/** A note move handler: rename `from` to `to`, both project-relative posix paths. */
type MoveHandler = (from: string, to: string) => void;

interface MoveContext {
  dir: string;
  groups: EditorGroup[];
  onMove: MoveHandler;
}

function basename(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function fileIcon(ext: string): Icon {
  return ext.toLowerCase() === "csv" ? FileCsv : FileText;
}

/** Kebab menu listing the groups a file can move into (the keyboard-accessible counterpart to drag-and-drop). */
function MoveMenu({ file, move }: { file: EditorFile; move: MoveContext }) {
  const [open, setOpen] = useState(false);
  const targets = [UNGROUPED, ...move.groups]
    .map((group) => ({ group, path: groupTargetPath(move.dir, group, file.name) }))
    .filter((target) => target.path !== file.path);

  if (targets.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        render={
          <Button
            variant="ghost"
            size="sm"
            shape="square"
            aria-label={`Move ${file.name}`}
            title="Move to group"
            className="flex-none opacity-0 group-hover/row:opacity-100 aria-expanded:opacity-100 focus-visible:opacity-100"
          />
        }
      >
        <DotsThreeVertical size={15} />
      </Popover.Trigger>
      <Popover.Content align="end" className="flex min-w-44 flex-col gap-0.5 p-1">
        <Text size="xs" DANGEROUS_className="px-2 py-1 font-medium text-kumo-subtle uppercase tracking-wide">
          Move to
        </Text>
        {targets.map(({ group, path }) => (
          <button
            key={group.id}
            type="button"
            onClick={() => {
              move.onMove(file.path, path);
              setOpen(false);
            }}
            className="rounded-md px-2 py-1.5 text-left text-sm text-kumo-default hover:bg-kumo-tint"
          >
            {group.label ?? group.id}
          </button>
        ))}
      </Popover.Content>
    </Popover>
  );
}

function FileRow({
  file,
  active,
  onSelect,
  move,
}: {
  file: EditorFile;
  active: boolean;
  onSelect: (path: string) => void;
  move: MoveContext | null;
}) {
  const FileGlyph = fileIcon(file.ext);
  return (
    <div
      draggable={move !== null}
      onDragStart={(event) => event.dataTransfer.setData("text/plain", file.path)}
      className={cn(
        "group/row flex items-center rounded-md",
        active ? "bg-kumo-tint" : "hover:bg-kumo-tint",
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(file.path)}
        aria-current={active ? "true" : undefined}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-brand",
          active ? "text-kumo-strong" : "text-kumo-default",
        )}
      >
        <FileGlyph size={15} className="flex-none text-kumo-subtle" />
        <span className="min-w-0 flex-1 truncate">{file.name}</span>
      </button>
      {move ? <MoveMenu file={file} move={move} /> : null}
    </div>
  );
}

function GroupSection({
  group,
  files,
  activePath,
  onSelect,
  move,
}: {
  group: EditorGroup;
  files: EditorFile[];
  activePath: string | null;
  onSelect: (path: string) => void;
  move: MoveContext | null;
}) {
  const [open, setOpen] = useState(true);
  const [dropping, setDropping] = useState(false);
  const GroupGlyph = pageIcon(group.icon);

  const dropHandlers = move
    ? {
        onDragOver: (event: React.DragEvent) => {
          event.preventDefault();
          setDropping(true);
        },
        onDragLeave: () => setDropping(false),
        onDrop: (event: React.DragEvent) => {
          event.preventDefault();
          setDropping(false);
          const from = event.dataTransfer.getData("text/plain");
          if (from) move.onMove(from, groupTargetPath(move.dir, group, basename(from)));
        },
      }
    : {};

  return (
    <Collapsible.Root
      open={open}
      onOpenChange={setOpen}
      className={cn("mb-1 rounded-md", dropping && "ring-2 ring-kumo-brand ring-inset")}
      {...dropHandlers}
    >
      <Collapsible.Trigger
        render={
          <button
            type="button"
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-brand hover:bg-kumo-tint"
          />
        }
      >
        <CaretRight size={12} className={cn("flex-none text-kumo-subtle transition-transform", open && "rotate-90")} />
        <GroupGlyph size={14} className="flex-none text-kumo-subtle" />
        <Text size="xs" DANGEROUS_className="min-w-0 flex-1 truncate font-medium text-kumo-subtle uppercase tracking-wide">
          {group.label ?? group.id}
        </Text>
      </Collapsible.Trigger>
      <Collapsible.Panel className="mt-0.5 ml-2 flex flex-col">
        {files.map((file) => (
          <FileRow key={file.path} file={file} active={file.path === activePath} onSelect={onSelect} move={move} />
        ))}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

export function FileTree({
  files,
  dir,
  groups,
  activePath,
  onSelect,
  onMove,
}: {
  files: EditorFile[];
  dir: string;
  groups: EditorGroup[] | undefined;
  activePath: string | null;
  onSelect: (path: string) => void;
  onMove?: MoveHandler;
}) {
  const grouped = groupFiles(files, dir, groups);
  const move: MoveContext | null = onMove && groups && groups.length > 0 ? { dir, groups, onMove } : null;

  if (files.length === 0) {
    return (
      <Text variant="secondary" size="sm" DANGEROUS_className="block px-3 py-4">
        No files yet.
      </Text>
    );
  }

  return (
    <div className="flex flex-col p-2">
      {grouped.map(({ group, files: groupFilesList }) => (
        <GroupSection
          key={group.id}
          group={group}
          files={groupFilesList}
          activePath={activePath}
          onSelect={onSelect}
          move={move}
        />
      ))}
    </div>
  );
}
