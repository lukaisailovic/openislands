"use client";

import { Fragment, useState } from "react";
import { CheckIcon, CopyIcon, CopyPrompt } from "./copy-prompt";

/** Paste this into a coding agent; it reads the start doc and builds the first dashboard. */
const AGENT_PROMPT =
  "Read https://openislands.sh/start.md then help me build my first agent-maintained dashboard.";

const tabs = [
  { key: "humans", label: "For humans", command: "npx openislands init my-dashboard" },
  {
    key: "agents",
    label: "For agents",
    command: "npx skills add lukaisailovic/openislands --skill openislands",
  },
] as const;

/**
 * The hero's get-started affordance: a two-tab terminal that hands a human the CLI
 * init command and an agent the skill-install command, with a copy button on the
 * active command and a Read docs link beside it. The one-paste agent prompt sits
 * below as a quieter secondary action.
 */
export function HeroTerminal() {
  const [active, setActive] = useState<(typeof tabs)[number]["key"]>("humans");
  const activeTab = tabs.find((tab) => tab.key === active) ?? tabs[0];

  return (
    <div className="oi-hero-terminal">
      <div className="oi-tabs" role="group" aria-label="Get started">
        {tabs.map((tab, index) => (
          <Fragment key={tab.key}>
            {index > 0 && <span className="oi-tabs-divider" aria-hidden="true" />}
            <button
              type="button"
              aria-pressed={active === tab.key}
              className="oi-tab"
              onClick={() => setActive(tab.key)}
            >
              {tab.label}
            </button>
          </Fragment>
        ))}
      </div>

      <div className="oi-terminal-row">
        <TerminalCommand command={activeTab.command} />
        <a href="/getting-started" className="oi-btn oi-btn-accent">
          Read docs
        </a>
      </div>

      <div className="oi-hero-prompt">
        <CopyPrompt prompt={AGENT_PROMPT} label="Copy agent prompt" />
      </div>
    </div>
  );
}

export interface TerminalCommandProps {
  /** The shell command shown after the prompt and copied on click. */
  command: string;
}

/**
 * A bordered terminal box: a muted `$` prompt, the command in mono, and a copy
 * button that swaps to a check for a moment. Shared by the hero and the closing
 * CTA band so both copy-and-go boxes look identical.
 */
export function TerminalCommand({ command }: TerminalCommandProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="oi-terminal" data-copied={copied || undefined}>
      <span className="oi-terminal-prompt" aria-hidden="true">
        $
      </span>
      <code className="oi-terminal-command" translate="no">
        {command}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy command to clipboard"
        className="oi-terminal-copy"
        data-copied={copied || undefined}
      >
        <span aria-hidden="true">{copied ? <CheckIcon /> : <CopyIcon />}</span>
        <span className="sr-only" aria-live="polite">
          {copied ? "Command copied to clipboard" : ""}
        </span>
      </button>
    </div>
  );
}

export default HeroTerminal;
