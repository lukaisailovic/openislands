"use client";

import { useState } from "react";

export interface CopyCommandProps {
  command: string;
  /**
   * `"shell"` (default) renders a terminal pill with a `$` prompt. `"prompt"`
   * renders the same pill for a natural-language agent prompt: no `$`, a sparkle
   * glyph instead, and the copy hint reads "copy prompt".
   */
  kind?: "shell" | "prompt";
  /** Overrides the leading glyph. Defaults to `$` for shell, a sparkle for prompt. */
  glyph?: string;
  /** Accessible label override. Defaults to "Copy command/prompt: <command>". */
  label?: string;
}

const DEFAULT_GLYPH: Record<NonNullable<CopyCommandProps["kind"]>, string> = {
  shell: "$",
  prompt: "✦",
};

/**
 * A copy-to-clipboard pill. In `shell` mode it's a terminal command with a
 * decorative `$`; in `prompt` mode it's an agent prompt with a sparkle glyph and
 * no shell prompt. Either way the leading glyph isn't copied, and the hint
 * confirms the copy for a moment so a reader knows the click landed.
 */
export function CopyCommand({ command, kind = "shell", glyph, label }: CopyCommandProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const leadingGlyph = glyph ?? DEFAULT_GLYPH[kind];
  const noun = kind === "prompt" ? "prompt" : "command";
  const ariaLabel = label ?? `Copy ${noun}: ${command}`;
  const hint = kind === "prompt" ? "copy prompt" : "copy";
  const variantClass = kind === "prompt" ? "oi-command-prompt-variant" : "oi-command-shell";

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={ariaLabel}
      className={`oi-command group ${variantClass}`}
    >
      <span aria-hidden className="oi-command-prompt">
        {leadingGlyph}
      </span>
      <code className="oi-command-text" translate="no">
        {command}
      </code>
      <span aria-hidden className="oi-command-hint">
        {copied ? "copied" : hint}
      </span>
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </button>
  );
}

export default CopyCommand;
