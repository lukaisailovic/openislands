"use client";

import { useState } from "react";

export interface CopyCommandProps {
  command: string;
}

/**
 * A terminal-style command pill that copies its command to the clipboard on
 * click. The leading `$` is decorative (not copied), and the label confirms the
 * copy for a moment so a reader knows the click landed.
 */
export function CopyCommand({ command }: CopyCommandProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy command: ${command}`}
      className="oi-command group"
    >
      <span aria-hidden className="oi-command-prompt">
        $
      </span>
      <code className="oi-command-text" translate="no">
        {command}
      </code>
      <span aria-hidden className="oi-command-hint">
        {copied ? "copied" : "copy"}
      </span>
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </button>
  );
}

export default CopyCommand;
