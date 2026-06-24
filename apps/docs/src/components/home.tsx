import { gitConfig } from "../lib/shared";
import { HeroTerminal, TerminalCommand } from "./hero-terminal";
import { LiveIsland } from "./live-island";
import { netWorthByMonth, sampleData } from "./sample-data";

const GITHUB_URL = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

/** The CLI's first command, offered inline in the closing CTA band as a copy-and-go. */
const INIT_COMMAND = "npx openislands init my-dashboard";

const kpiManifest = `{
  "type": "metric.kpi",
  "title": "Net worth",
  "dataset": "net_worth",
  "value": "net_worth_eur",
  "compareTo": "prev",
  "format": "eur"
}`;

/** Revenue against a target: the line-chart proof beneath the headline pairing. */
const revenueByMonth = sampleData(
  [
    { name: "month", type: "date" },
    { name: "revenue_eur", type: "double" },
    { name: "expenses_eur", type: "double" },
    { name: "target_eur", type: "double" },
  ],
  [
    { month: "2026-01-01", revenue_eur: 42_300, expenses_eur: 31_000, target_eur: 45_000 },
    { month: "2026-02-01", revenue_eur: 45_100, expenses_eur: 32_400, target_eur: 47_000 },
    { month: "2026-03-01", revenue_eur: 44_200, expenses_eur: 33_100, target_eur: 49_000 },
    { month: "2026-04-01", revenue_eur: 49_800, expenses_eur: 34_600, target_eur: 51_000 },
    { month: "2026-05-01", revenue_eur: 52_600, expenses_eur: 35_200, target_eur: 53_000 },
    { month: "2026-06-01", revenue_eur: 56_400, expenses_eur: 36_800, target_eur: 55_000 },
  ],
  "monthly",
);

const features = [
  {
    name: "Declarative",
    body: "A dashboard is a JSON manifest of islands bound to datasets. There's no rendering code to maintain: you describe what you want, the runtime draws it.",
  },
  {
    name: "Typed and safe",
    body: "Every binding is checked against your live data. Point an island at a field that doesn't exist and the build fails and names the island. You never get a silently wrong chart.",
  },
  {
    name: "Local-first",
    body: "Your files are the source of truth. The runtime queries them on every request, so there are no snapshots to drift out of date.",
  },
  {
    name: "Agent-native",
    body: "A CLI and an MCP server give an agent a diffed, reversible way to edit the app, so it can keep your dashboard healthy for months.",
  },
];

const loopSteps = [
  { name: "read", body: "Pull the manifest, the island schemas, and a slice of the live data — all from one script." },
  { name: "stage", body: "Patch a manifest section; it's validated against the data before a byte is written." },
  { name: "diff", body: "See exactly what changes. Nothing is written yet." },
  { name: "apply", body: "Write it, and snapshot the prior version as a checkpoint." },
  { name: "rollback", body: "Restore any checkpoint, byte for byte, if something looks off." },
];

/**
 * The documentation landing page. The hero sits inside Fumadocs' HomeLayout (supplied
 * by the route), and the sections below are themed with the OpenIslands brand tokens
 * (a dark surface plus the tide-teal accent). It carries the one idea worth proving on
 * a marketing page: a manifest on the left renders into a real island on the right,
 * drawn by the same runtime renderer the docs and a production dashboard share.
 */
export function Home() {
  return (
    <div className="oi-home">
      <header className="oi-hero">
        <div className="oi-hero-brand">
          <img className="oi-hero-mark" src="/logo-light.svg" alt="" width="60" height="60" />
          <h1 className="oi-hero-word">OpenIslands</h1>
        </div>
        <p className="oi-hero-tagline">
          Dashboards an agent can maintain for months, without them rotting.
        </p>
        <p className="oi-hero-desc">
          OpenIslands is a local-first runtime for agent-maintained data apps. You bind typed
          islands to your own files in a manifest, and never touch rendering code.
        </p>
        <HeroTerminal />
      </header>

      <section className="oi-section">
        <p className="oi-eyebrow">the whole idea</p>
        <h2 className="oi-section-title">
          Your agent writes the manifest. The runtime renders the island.
        </h2>
        <div className="oi-split">
          <figure className="oi-panel oi-panel-code">
            <figcaption className="oi-panel-head" translate="no">
              manifest.json
            </figcaption>
            <pre className="oi-code" translate="no">
              <code>{kpiManifest}</code>
            </pre>
          </figure>
          <div className="oi-seam" aria-hidden="true">
            <span className="oi-seam-arrow">→</span>
          </div>
          <figure className="oi-panel oi-panel-live">
            <figcaption className="oi-panel-head">
              <span translate="no">metric.kpi</span>
            </figcaption>
            <LiveIsland
              type="metric.kpi"
              config={{ title: "Net worth", value: "net_worth_eur", compareTo: "prev", format: "eur" }}
              data={netWorthByMonth}
              framed={false}
            />
          </figure>
        </div>
        <p className="oi-caption">
          That tile is the runtime's own renderer, drawn right here from the data the manifest
          points at. Not a screenshot.
        </p>
        <figure className="oi-panel oi-panel-live oi-panel-wide">
          <figcaption className="oi-panel-head">
            <span translate="no">timeseries.line</span>
          </figcaption>
          <LiveIsland
            type="timeseries.line"
            config={{
              title: "Revenue vs target",
              x: "month",
              y: ["revenue_eur", "expenses_eur"],
              options: { goalField: "target_eur" },
              format: "eur",
            }}
            data={revenueByMonth}
            height={280}
            framed={false}
          />
        </figure>
      </section>

      <section className="oi-section">
        <p className="oi-eyebrow">why it holds up</p>
        <h2 className="oi-section-title">Built so an agent can't quietly break it.</h2>
        <ul className="oi-grid">
          {features.map((feature) => (
            <li key={feature.name} className="oi-card">
              <h3 className="oi-card-title">{feature.name}</h3>
              <p className="oi-card-body">{feature.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="oi-section oi-loop-section">
        <p className="oi-eyebrow">the safe edit loop</p>
        <h2 className="oi-section-title">An agent edits the manifest, not your rendering code.</h2>
        <p className="oi-lede">
          The MCP server runs in Code Mode — one tool the agent drives with JavaScript — and it's
          read-many, write-one. Every change runs the same path, and every write is reversible, so
          an agent can maintain the app without ever leaving it broken.
        </p>
        <ol className="oi-loop">
          {loopSteps.map((step) => (
            <li key={step.name} className="oi-loop-step">
              <span className="oi-loop-name" translate="no">
                {step.name}
              </span>
              <p className="oi-loop-body">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="oi-cta">
        <h2 className="oi-cta-title">Point your agent at a folder. Get a dashboard it can keep.</h2>
        <div className="oi-cta-command">
          <TerminalCommand command={INIT_COMMAND} />
        </div>
        <div className="oi-hero-buttons oi-cta-buttons">
          <a href="/getting-started" className="oi-btn oi-btn-accent">
            Get started
          </a>
          <a href={GITHUB_URL} className="oi-btn">
            GitHub
          </a>
        </div>
      </section>

      <footer className="oi-footer">
        <div className="oi-footer-top">
          <div className="oi-footer-brand">
            <div className="oi-footer-lockup">
              <img src="/logo-light.svg" alt="" width="32" height="32" />
              <span className="oi-footer-word">OpenIslands</span>
            </div>
            <p className="oi-footer-tagline">
              Local-first runtime for agent-maintained data apps.
            </p>
          </div>
          <nav className="oi-footer-columns" aria-label="Footer">
            <div className="oi-footer-col">
              <p className="oi-footer-heading">Documentation</p>
              <a href="/introduction" className="oi-footer-link">
                Introduction
              </a>
              <a href="/getting-started" className="oi-footer-link">
                Getting Started
              </a>
              <a href="/cli" className="oi-footer-link">
                CLI
              </a>
              <a href="/mcp" className="oi-footer-link">
                MCP Server
              </a>
            </div>
            <div className="oi-footer-col">
              <p className="oi-footer-heading">Concepts</p>
              <a href="/concepts/manifest" className="oi-footer-link">
                The Manifest
              </a>
              <a href="/concepts/data-contracts" className="oi-footer-link">
                Data Contracts
              </a>
              <a href="/islands/overview" className="oi-footer-link">
                Islands
              </a>
            </div>
            <div className="oi-footer-col">
              <p className="oi-footer-heading">Project</p>
              <a href={GITHUB_URL} className="oi-footer-link" target="_blank" rel="noreferrer">
                GitHub
              </a>
              <a href="/agents" className="oi-footer-link">
                Agent Setup
              </a>
              <a href="/llms.txt" className="oi-footer-link" translate="no">
                llms.txt
              </a>
            </div>
          </nav>
        </div>
        <div className="oi-footer-bar">
          <p className="oi-footer-legal" translate="no">
            MIT licensed · local-first
          </p>
          <a
            href={GITHUB_URL}
            className="oi-footer-github"
            target="_blank"
            rel="noreferrer"
            aria-label="OpenIslands on GitHub"
          >
            <svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor" aria-hidden="true">
              <path d="M12 .5C5.37.5 0 5.78 0 12.29c0 5.21 3.44 9.63 8.2 11.19.6.11.82-.25.82-.56v-2.18c-3.34.71-4.04-1.58-4.04-1.58-.55-1.36-1.34-1.73-1.34-1.73-1.09-.73.08-.71.08-.71 1.2.08 1.84 1.21 1.84 1.21 1.07 1.8 2.81 1.28 3.49.98.11-.76.42-1.28.76-1.57-2.67-.3-5.47-1.31-5.47-5.81 0-1.28.47-2.33 1.24-3.15-.13-.3-.54-1.51.12-3.15 0 0 1.01-.32 3.3 1.2.96-.26 1.98-.39 3-.39 1.02 0 2.04.13 3 .39 2.29-1.52 3.3-1.2 3.3-1.2.66 1.64.25 2.85.12 3.15.77.82 1.24 1.87 1.24 3.15 0 4.51-2.81 5.5-5.49 5.79.43.36.81 1.08.81 2.18v3.23c0 .31.21.68.83.56C20.56 21.91 24 17.5 24 12.29 24 5.78 18.63.5 12 .5Z" />
            </svg>
          </a>
        </div>
      </footer>
    </div>
  );
}

export default Home;
