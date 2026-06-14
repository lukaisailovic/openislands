import { Link, cn } from "@cloudflare/kumo";
import { CheckCircle, Info, Warning, WarningOctagon, type Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { IslandRenderProps } from "../types.js";

const INLINE = /(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g;
const LINK = /^\[([^\]]+)\]\(([^)]+)\)$/;

const CODE_CLASS = "rounded bg-kumo-recessed px-1.5 py-0.5 font-mono text-[0.9em]";

/** Parse inline markdown (links, code, bold, italic) into React nodes. Bold/italic recurse. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let key = 0;
  for (const part of text.split(INLINE)) {
    if (part === "") continue;
    const link = LINK.exec(part);
    if (link) {
      out.push(
        <Link key={key++} href={link[2]} variant="inline">
          {link[1]}
        </Link>,
      );
      continue;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      out.push(
        <code key={key++} className={CODE_CLASS}>
          {part.slice(1, -1)}
        </code>,
      );
      continue;
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      out.push(<strong key={key++}>{inline(part.slice(2, -2))}</strong>);
      continue;
    }
    if (
      (part.startsWith("*") && part.endsWith("*")) ||
      (part.startsWith("_") && part.endsWith("_"))
    ) {
      out.push(<em key={key++}>{inline(part.slice(1, -1))}</em>);
      continue;
    }
    out.push(part);
  }
  return out;
}

function renderBlock(block: string, key: number): ReactNode {
  const b = block.trim();
  if (b.startsWith("```")) {
    const body = b.replace(/^```[^\n]*\n?/, "").replace(/\n?```$/, "");
    return (
      <pre
        key={key}
        className="overflow-x-auto rounded-md bg-kumo-recessed px-3 py-2.5 text-[13px]"
      >
        <code className="font-mono">{body}</code>
      </pre>
    );
  }
  if (b.startsWith("## "))
    return (
      <h3 key={key} className="mt-1 mb-1.5 text-[15px] font-semibold text-kumo-strong">
        {inline(b.slice(3))}
      </h3>
    );
  if (b.startsWith("# "))
    return (
      <h2 key={key} className="mt-1 mb-1.5 text-base font-semibold text-kumo-strong">
        {inline(b.slice(2))}
      </h2>
    );
  const lines = b.split("\n");
  if (lines.every((l) => l.startsWith("- "))) {
    return (
      <ul key={key} className="my-1.5 list-disc pl-[18px]">
        {lines.map((l, i) => (
          <li key={i}>{inline(l.slice(2))}</li>
        ))}
      </ul>
    );
  }
  return (
    <p key={key} className="my-1.5">
      {inline(b)}
    </p>
  );
}

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/** Drop a leading YAML frontmatter block; its keys are data, not prose. */
export function stripFrontmatter(markdown: string): string {
  return markdown.replace(FRONTMATTER, "");
}

export function renderMarkdown(markdown: string): ReactNode {
  return (
    <div className="text-sm leading-relaxed text-kumo-default [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      {markdown.split("\n\n").map(renderBlock)}
    </div>
  );
}

type Tone = "info" | "success" | "warning" | "danger";

interface ToneStyle {
  Glyph: Icon;
  icon: string;
  border: string;
  surface: string;
}

const TONES: Record<Tone, ToneStyle> = {
  info: {
    Glyph: Info,
    icon: "text-kumo-info",
    border: "border-l-kumo-info",
    surface: "bg-kumo-info-tint/40",
  },
  success: {
    Glyph: CheckCircle,
    icon: "text-kumo-success",
    border: "border-l-kumo-success",
    surface: "bg-kumo-success-tint/40",
  },
  warning: {
    Glyph: Warning,
    icon: "text-kumo-warning",
    border: "border-l-kumo-warning",
    surface: "bg-kumo-warning-tint/50",
  },
  danger: {
    Glyph: WarningOctagon,
    icon: "text-kumo-danger",
    border: "border-l-kumo-danger",
    surface: "bg-kumo-danger-tint/40",
  },
};

function isTone(value: unknown): value is Tone {
  return value === "info" || value === "success" || value === "warning" || value === "danger";
}

function Callout({ tone, children }: { tone: Tone; children: ReactNode }) {
  const { Glyph, icon, border, surface } = TONES[tone];
  return (
    <div
      data-tone={tone}
      className={cn("flex gap-2.5 rounded-md border-l-2 px-3.5 py-3", border, surface)}
    >
      <Glyph size={17} weight="fill" aria-hidden className={cn("mt-px flex-none", icon)} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function NoteCard({ config }: IslandRenderProps) {
  const markdown = String(config.markdown ?? "");
  const body = renderMarkdown(markdown);

  if (!isTone(config.tone)) return body;

  return <Callout tone={config.tone}>{body}</Callout>;
}
