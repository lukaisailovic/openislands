"use client";

import { useState } from "react";

export interface CopyPromptProps {
  /** Text written to the clipboard when the button is pressed. */
  prompt: string;
  /** Resting-state button label. */
  label: string;
}

/**
 * A single hero button that copies an agent-ready prompt to the clipboard. It mirrors
 * the neighbouring landing buttons and swaps to a checkmark and "Copied" for a moment
 * so a reader knows the click landed.
 */
export function CopyPrompt({ prompt, label }: CopyPromptProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`${label} to clipboard`}
      className="oi-copy-prompt"
      data-copied={copied || undefined}
    >
      <span className="oi-copy-prompt-icon" aria-hidden>
        {copied ? <CheckIcon /> : <CopyIcon />}
      </span>
      {copied ? "Copied" : label}
      <span className="sr-only" aria-live="polite">
        {copied ? "Prompt copied to clipboard" : ""}
      </span>
    </button>
  );
}

export function CopyIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export default CopyPrompt;
