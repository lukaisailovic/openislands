import { Link, Text } from "@cloudflare/kumo";
import { useEffect, useState } from "react";
import { useAppId } from "../client/useAppId.js";
import type { IslandRenderProps } from "../types.js";
import { renderMarkdown, stripFrontmatter } from "./NoteCard.js";

type Kind = "pdf" | "markdown" | "image" | "link";

interface DocSpec {
  kind: Kind;
  file?: string;
  label: string;
  url: string;
}

/** A project file resolves through the confined /api/file route; an external href is used as-is. */
function readSpec(appId: string, config: IslandRenderProps["config"]): DocSpec {
  const file = config.file as string | undefined;
  const href = config.href as string | undefined;
  const kind = (config.kind as Kind | undefined) ?? "link";
  const url = file
    ? `/api/file?app=${encodeURIComponent(appId)}&path=${encodeURIComponent(file)}`
    : (href ?? "#");
  return { kind, file, label: file ?? href ?? "source", url };
}

function OpenLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noreferrer"
      variant="inline"
      className="break-all text-sm"
    >
      {label} <Link.ExternalIcon />
    </Link>
  );
}

function MarkdownDoc({ url }: { url: string }) {
  const [state, setState] = useState<{ text?: string; error?: string }>({});
  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((text) => !cancelled && setState({ text }))
      .catch((err: Error) => !cancelled && setState({ error: err.message }));
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (state.error)
    return (
      <Text variant="secondary" size="sm">
        could not load: {state.error}
      </Text>
    );
  if (state.text === undefined)
    return (
      <Text variant="secondary" size="sm">
        loading…
      </Text>
    );
  return (
    <div className="max-h-90 overflow-y-auto text-sm">
      {renderMarkdown(stripFrontmatter(state.text))}
    </div>
  );
}

export function SourceDoc({ config }: IslandRenderProps) {
  const spec = readSpec(useAppId(), config);

  if (spec.kind === "image") {
    return <img src={spec.url} alt={spec.label} className="max-w-full rounded-md" />;
  }

  if (spec.kind === "pdf") {
    return (
      <div>
        <object
          data={spec.url}
          type="application/pdf"
          className="h-80 w-full rounded-md border border-kumo-hairline"
        >
          <OpenLink href={spec.url} label={`Open ${spec.label}`} />
        </object>
        <div className="mt-1.5">
          <OpenLink href={spec.url} label="Open in new tab" />
        </div>
      </div>
    );
  }

  if (spec.kind === "markdown" && spec.file) return <MarkdownDoc url={spec.url} />;

  return <OpenLink href={spec.url} label={spec.label} />;
}
