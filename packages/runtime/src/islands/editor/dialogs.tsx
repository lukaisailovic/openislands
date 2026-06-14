import { Button, Dialog, Input, Text } from "@cloudflare/kumo";
import { useEffect, useState } from "react";

/** Join a posix dir and a filename, collapsing any stray slashes. */
function joinPath(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, "")}/${name.replace(/^\/+/, "")}`;
}

function ensureExtension(name: string): string {
  return /\.[^./]+$/.test(name) ? name : `${name}.md`;
}

export function NewFileDialog({
  open,
  onOpenChange,
  dir,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dir: string;
  onCreate: (path: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(joinPath(dir, ensureExtension(trimmed)));
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
        <Text variant="secondary" size="xs">
          Created in {dir}. A “.md” extension is added if you omit one.
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
