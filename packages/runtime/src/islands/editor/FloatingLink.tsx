import { $isLinkNode } from "@lexical/link";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $findMatchingParent } from "@lexical/utils";
import { Button, Input, Popover } from "@cloudflare/kumo";
import { ArrowSquareOut, LinkBreak } from "@phosphor-icons/react";
import { $getNearestNodeFromDOMNode, $getNodeByKey, type LexicalEditor } from "lexical";
import { useEffect, useState } from "react";

interface LinkRef {
  el: HTMLAnchorElement;
  key: string;
  url: string;
}

function closestLink(target: EventTarget | null): HTMLAnchorElement | null {
  return target instanceof HTMLElement ? target.closest("a") : null;
}

/** Resolve the LinkNode behind an `<a>` element to its node key and current URL. */
function resolveLink(editor: LexicalEditor, el: HTMLAnchorElement): LinkRef | null {
  let ref: LinkRef | null = null;
  // editor.read (not editorState.read) sets the active editor that
  // $getNearestNodeFromDOMNode needs to map the DOM node back to its key.
  editor.read(() => {
    const node = $getNearestNodeFromDOMNode(el);
    const link = node && ($isLinkNode(node) ? node : $findMatchingParent(node, $isLinkNode));
    if (link && $isLinkNode(link)) ref = { el, key: link.getKey(), url: link.getURL() };
  });
  return ref;
}

/**
 * Link affordances for the editor: hovering a link surfaces its URL, and clicking
 * one (when editable) opens a manage popover to edit the URL, open it, or remove
 * the link. In read-only mode the click falls through so the browser follows the
 * link as usual. Both behaviors track the same `<a>` under the pointer.
 */
export function FloatingLinkPlugin({ editable }: { editable: boolean }) {
  const [editor] = useLexicalComposerContext();
  const [hover, setHover] = useState<{ left: number; top: number; url: string } | null>(null);
  const [edit, setEdit] = useState<LinkRef | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    let current: HTMLElement | null = null;

    const onOver = (event: Event) => {
      const link = closestLink(event.target);
      if (!link) return;
      const ref = resolveLink(editor, link);
      if (!ref) return;
      const rect = link.getBoundingClientRect();
      setHover({ left: rect.left, top: rect.bottom + 6, url: ref.url });
    };
    const onOut = (event: Event) => {
      if (closestLink(event.target)) setHover(null);
    };
    const onClick = (event: Event) => {
      const link = closestLink(event.target);
      if (!link || !editable) return;
      const ref = resolveLink(editor, link);
      if (!ref) return;
      event.preventDefault();
      setHover(null);
      setDraft(ref.url);
      setEdit(ref);
    };

    const attach = (root: HTMLElement | null) => {
      if (current) {
        current.removeEventListener("mouseover", onOver);
        current.removeEventListener("mouseout", onOut);
        current.removeEventListener("click", onClick);
      }
      current = root;
      if (root) {
        root.addEventListener("mouseover", onOver);
        root.addEventListener("mouseout", onOut);
        root.addEventListener("click", onClick);
      }
    };

    const unregister = editor.registerRootListener((root) => attach(root));
    return () => {
      attach(null);
      unregister();
    };
  }, [editor, editable]);

  const close = () => {
    setEdit(null);
    editor.focus();
  };

  const removeLink = () => {
    if (!edit) return;
    editor.update(() => {
      const node = $getNodeByKey(edit.key);
      if (!$isLinkNode(node)) return;
      for (const child of node.getChildren()) node.insertBefore(child);
      node.remove();
    });
    close();
  };

  const commit = () => {
    if (!edit) return;
    const url = draft.trim();
    if (!url) {
      removeLink();
      return;
    }
    editor.update(() => {
      const node = $getNodeByKey(edit.key);
      if ($isLinkNode(node)) node.setURL(url);
    });
    close();
  };

  return (
    <>
      {hover && !edit ? (
        <div
          className="pointer-events-none fixed z-50 max-w-sm truncate rounded-md border border-kumo-hairline bg-kumo-base px-2 py-1 text-xs text-kumo-subtle shadow-md"
          style={{ left: hover.left, top: hover.top }}
        >
          {hover.url || "(empty link)"}
        </div>
      ) : null}

      {edit ? (
        <Popover open onOpenChange={(open) => !open && setEdit(null)}>
          <Popover.Content
            anchor={edit.el}
            align="start"
            className="flex w-[min(90vw,22rem)] items-center gap-1.5 p-2"
          >
            <Input
              size="sm"
              aria-label="Link URL"
              placeholder="https://"
              value={draft}
              autoFocus
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commit();
                }
              }}
              className="min-w-0 flex-1"
            />
            <Button
              size="sm"
              variant="ghost"
              shape="square"
              aria-label="Open link"
              title="Open link"
              onClick={() => window.open(draft.trim() || edit.url, "_blank", "noopener,noreferrer")}
            >
              <ArrowSquareOut size={15} />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              shape="square"
              aria-label="Remove link"
              title="Remove link"
              onClick={removeLink}
            >
              <LinkBreak size={15} />
            </Button>
          </Popover.Content>
        </Popover>
      ) : null}
    </>
  );
}
