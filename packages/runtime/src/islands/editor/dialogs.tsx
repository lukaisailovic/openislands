import { Button, Checkbox, Dialog, Input, Select, Text } from "@cloudflare/kumo";
import { useEffect, useState } from "react";
import { groupTargetPath, UNGROUPED } from "./grouping.js";
import type { EditorGroup } from "./types.js";

function ensureExtension(name: string): string {
  return /\.[^./]+$/.test(name) ? name : `${name}.md`;
}

export function NewFileDialog({
  open,
  onOpenChange,
  dir,
  groups,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dir: string;
  groups: EditorGroup[] | undefined;
  onCreate: (path: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState(UNGROUPED.id);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setGroupId(UNGROUPED.id);
      setError(null);
    }
  }, [open]);

  const target = groups?.find((group) => group.id === groupId) ?? UNGROUPED;
  const folder = groupTargetPath(dir, target, "") || ".";

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(groupTargetPath(dir, target, ensureExtension(trimmed)));
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the note.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog size="sm" className="t-modal flex w-[min(92vw,24rem)] flex-col gap-4 p-6">
        <Dialog.Title className="text-base font-medium text-kumo-strong">New note</Dialog.Title>
        <Input
          label="File name"
          placeholder="meeting-notes.md"
          value={name}
          autoFocus
          error={error ?? undefined}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
        />
        {groups && groups.length > 0 ? (
          <Select
            label="Folder"
            value={groupId}
            onValueChange={(value) => typeof value === "string" && setGroupId(value)}
          >
            <Select.Option value={UNGROUPED.id}>Ungrouped</Select.Option>
            {groups.map((group) => (
              <Select.Option key={group.id} value={group.id}>
                {group.label ?? group.id}
              </Select.Option>
            ))}
          </Select>
        ) : null}
        <Text variant="secondary" size="xs">
          Created in {folder}. A “.md” extension is added if you omit one.
        </Text>
        <div className="flex justify-end gap-2">
          <Dialog.Close
            render={(props) => (
              <Button {...props} variant="ghost" size="sm">
                Cancel
              </Button>
            )}
          />
          <Button variant="primary" size="sm" loading={busy} onClick={() => void submit()}>
            Create
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  );
}

export function DeleteFileDialog({
  open,
  onOpenChange,
  path,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  path: string;
  onDelete: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      await onDelete();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root role="alertdialog" open={open} onOpenChange={onOpenChange}>
      <Dialog size="sm" className="t-modal flex w-[min(92vw,24rem)] flex-col gap-3 p-6">
        <Dialog.Title className="text-base font-medium text-kumo-strong">Delete this note?</Dialog.Title>
        <Dialog.Description className="text-sm text-kumo-subtle">
          <span className="font-mono text-kumo-default">{path}</span> will be removed. A snapshot is kept in
          version history, so you can restore it later.
        </Dialog.Description>
        <div className="mt-1 flex justify-end gap-2">
          <Dialog.Close
            render={(props) => (
              <Button {...props} variant="ghost" size="sm">
                Cancel
              </Button>
            )}
          />
          <Button variant="destructive" size="sm" loading={busy} onClick={() => void confirm()}>
            Delete
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  );
}

/** Clamp a raw number-input value into [min, max], falling back to `min` for non-numbers. */
function clampSize(raw: string, min: number, max: number): number {
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function InsertTableDialog({
  open,
  onOpenChange,
  onInsert,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (rows: number, columns: number, header: boolean) => void;
}) {
  const [rows, setRows] = useState(3);
  const [columns, setColumns] = useState(3);
  const [header, setHeader] = useState(true);

  useEffect(() => {
    if (open) {
      setRows(3);
      setColumns(3);
      setHeader(true);
    }
  }, [open]);

  const insert = () => {
    onInsert(rows, columns, header);
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog size="sm" className="t-modal flex w-[min(92vw,22rem)] flex-col gap-4 p-6">
        <Dialog.Title className="text-base font-medium text-kumo-strong">Insert table</Dialog.Title>
        <div className="flex gap-3">
          <Input
            label="Rows"
            type="number"
            min={1}
            max={50}
            value={String(rows)}
            onChange={(event) => setRows(clampSize(event.target.value, 1, 50))}
          />
          <Input
            label="Columns"
            type="number"
            min={1}
            max={10}
            value={String(columns)}
            onChange={(event) => setColumns(clampSize(event.target.value, 1, 10))}
          />
        </div>
        <Checkbox label="Header row" checked={header} onCheckedChange={(checked) => setHeader(checked === true)} />
        <div className="flex justify-end gap-2">
          <Dialog.Close
            render={(props) => (
              <Button {...props} variant="ghost" size="sm">
                Cancel
              </Button>
            )}
          />
          <Button variant="primary" size="sm" onClick={insert}>
            Insert
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  );
}
