import { Collapsible, Text, cn } from "@cloudflare/kumo";
import { CaretRight, FileCsv, FileText, Folder, type Icon } from "@phosphor-icons/react";
import * as PhosphorIcons from "@phosphor-icons/react";
import { useState } from "react";
import { groupFiles } from "./grouping.js";
import type { EditorFile, EditorGroup } from "./types.js";

/** Resolve a Phosphor icon name (e.g. "files", "folder-open") to its component, falling back to a folder. */
function groupIcon(name: string | undefined): Icon {
  if (!name) return Folder;
  const pascal = name
    .split(/[-_\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  const icons = PhosphorIcons as unknown as Record<string, Icon | undefined>;
  return icons[pascal] ?? Folder;
}

function fileIcon(ext: string): Icon {
  return ext.toLowerCase() === "csv" ? FileCsv : FileText;
}

function FileRow({
  file,
  active,
  onSelect,
}: {
  file: EditorFile;
  active: boolean;
  onSelect: (path: string) => void;
}) {
  const FileGlyph = fileIcon(file.ext);
  return (
    <button
      type="button"
      onClick={() => onSelect(file.path)}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-brand",
        active ? "bg-kumo-tint text-kumo-strong" : "text-kumo-default hover:bg-kumo-tint",
      )}
    >
      <FileGlyph size={15} className="flex-none text-kumo-subtle" />
      <span className="min-w-0 flex-1 truncate">{file.name}</span>
    </button>
  );
}

function GroupSection({
  group,
  files,
  activePath,
  onSelect,
}: {
  group: EditorGroup;
  files: EditorFile[];
  activePath: string | null;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const GroupGlyph = groupIcon(group.icon);
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="mb-1">
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
          <FileRow key={file.path} file={file} active={file.path === activePath} onSelect={onSelect} />
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
}: {
  files: EditorFile[];
  dir: string;
  groups: EditorGroup[] | undefined;
  activePath: string | null;
  onSelect: (path: string) => void;
}) {
  const grouped = groupFiles(files, dir, groups);

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
        />
      ))}
    </div>
  );
}
