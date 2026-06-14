import { LinkButton, Text, cn } from "@cloudflare/kumo";
import {
  ArrowSquareOut,
  FilePdf,
  FileText,
  Globe,
  type Icon,
  Image as ImageIcon,
  LinkSimple,
} from "@phosphor-icons/react";
import { type ReactNode, useEffect, useState } from "react";
import { useAppId } from "../client/useAppId.js";
import type { IslandRenderProps } from "../types.js";
import { renderMarkdown, stripFrontmatter } from "./NoteCard.js";

type Kind = "pdf" | "markdown" | "image" | "link";

interface DocSpec {
  kind: Kind;
  file?: string;
  href?: string;
  label?: string;
  description?: string;
  name: string;
  url: string;
}

const KIND_META: Record<Kind, { Glyph: Icon; noun: string }> = {
  pdf: { Glyph: FilePdf, noun: "PDF document" },
  markdown: { Glyph: FileText, noun: "Markdown document" },
  image: { Glyph: ImageIcon, noun: "Image" },
  link: { Glyph: LinkSimple, noun: "Link" },
};

function basename(path: string): string {
  return path.replace(/[/\\]+$/, "").split(/[/\\]/).at(-1) || path;
}

function hostname(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
}

/** A readable title that never leaks the raw `/api/file?...` URL: explicit label, else a file's name, else a link's host. */
function displayName(config: IslandRenderProps["config"], file?: string, href?: string): string {
  const label = config.label as string | undefined;
  if (label) return label;
  if (file) return basename(file);
  if (href) return hostname(href);
  return "source";
}

/** A project file resolves through the confined /api/file route; an external href is used as-is. */
function readSpec(appId: string, config: IslandRenderProps["config"]): DocSpec {
  const file = config.file as string | undefined;
  const href = config.href as string | undefined;
  const kind = (config.kind as Kind | undefined) ?? "link";
  const url = file
    ? `/api/file?app=${encodeURIComponent(appId)}&path=${encodeURIComponent(file)}`
    : (href ?? "#");
  return {
    kind,
    file,
    href,
    label: config.label as string | undefined,
    description: config.description as string | undefined,
    name: displayName(config, file, href),
    url,
  };
}

/**
 * The line under the document name: an author-given description, else the file path, else the
 * document kind. Links never echo their raw href here — the name already shows the host, and the
 * full URL stays behind the Open action.
 */
function secondaryLine(spec: DocSpec): string {
  if (spec.description) return spec.description;
  if (spec.file) return spec.file;
  return KIND_META[spec.kind].noun;
}

function OpenButton({ url, name }: { url: string; name: string }) {
  return (
    <LinkButton
      href={url}
      target="_blank"
      rel="noreferrer"
      variant="secondary"
      size="sm"
      icon={ArrowSquareOut}
      aria-label={`Open ${name} in a new tab`}
    >
      Open
    </LinkButton>
  );
}

function DocHeader({ spec, action, glyph }: { spec: DocSpec; action?: ReactNode; glyph?: Icon }) {
  const Glyph = glyph ?? KIND_META[spec.kind].Glyph;
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-9 flex-none items-center justify-center rounded-lg bg-kumo-recessed text-kumo-subtle">
        <Glyph size={18} aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <Text size="sm" DANGEROUS_className="block truncate font-medium text-kumo-strong">
          {spec.name}
        </Text>
        <Text variant="secondary" size="xs" DANGEROUS_className="block truncate">
          {secondaryLine(spec)}
        </Text>
      </div>
      {action ? <div className="flex-none">{action}</div> : null}
    </div>
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
      <Text variant="secondary" size="sm" DANGEROUS_className="text-kumo-danger">
        Couldn't load this document: {state.error}
      </Text>
    );
  if (state.text === undefined)
    return (
      <Text variant="secondary" size="sm">
        Loading…
      </Text>
    );
  return (
    <div className="max-h-90 overflow-y-auto pr-1">{renderMarkdown(stripFrontmatter(state.text))}</div>
  );
}

const PANEL = "rounded-md border border-kumo-hairline bg-kumo-recessed/40 p-3";

export function SourceDoc({ config }: IslandRenderProps) {
  const spec = readSpec(useAppId(), config);

  if (spec.kind === "image") {
    return (
      <div className="flex flex-col gap-2.5">
        <DocHeader spec={spec} action={<OpenButton url={spec.url} name={spec.name} />} />
        <a
          href={spec.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${spec.name} at full size in a new tab`}
          className="block overflow-hidden rounded-md border border-kumo-hairline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-brand"
        >
          <img
            src={spec.url}
            alt={spec.description ?? spec.name}
            className="max-h-72 w-full bg-kumo-recessed object-contain"
          />
        </a>
      </div>
    );
  }

  if (spec.kind === "pdf") {
    return (
      <div className="flex flex-col gap-2.5">
        <DocHeader spec={spec} action={<OpenButton url={spec.url} name={spec.name} />} />
        <object
          data={spec.url}
          type="application/pdf"
          aria-label={spec.name}
          className="h-80 w-full rounded-md border border-kumo-hairline"
        >
          <div className={cn(PANEL, "text-center")}>
            <Text variant="secondary" size="sm" DANGEROUS_className="mb-2 block">
              This preview can't be shown inline.
            </Text>
            <OpenButton url={spec.url} name={spec.name} />
          </div>
        </object>
        <a
          href={spec.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 self-start text-xs text-kumo-subtle hover:text-kumo-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-brand"
        >
          Open in new tab
          <ArrowSquareOut size={12} aria-hidden />
        </a>
      </div>
    );
  }

  if (spec.kind === "markdown" && spec.file) {
    return (
      <div className="flex flex-col gap-2.5">
        <DocHeader spec={spec} action={<OpenButton url={spec.url} name={spec.name} />} />
        <div className={PANEL}>
          <MarkdownDoc url={spec.url} />
        </div>
      </div>
    );
  }

  const glyph = spec.kind === "link" ? Globe : undefined;
  return (
    <div className={PANEL}>
      <DocHeader spec={spec} glyph={glyph} action={<OpenButton url={spec.url} name={spec.name} />} />
    </div>
  );
}
