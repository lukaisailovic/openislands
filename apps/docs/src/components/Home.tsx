import { HomePage } from "vocs";
import { CopyCommand } from "./CopyCommand.client";
import { LiveIsland } from "./LiveIsland.client";
import { netWorthByMonth, sampleData } from "./sampleData";

const GITHUB_URL = "https://github.com/lukaisailovic/openislands";

const kpiManifest = `{
  "type": "metric.kpi",
  "title": "Net worth",
  "dataset": "net_worth",
  "value": "net_worth_eur",
  "compareTo": "prev",
  "format": "eur"
}`;

/** Revenue against a target — the line-chart proof beneath the headline pairing. */
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
    body: "A dashboard is a JSON manifest of islands bound to datasets. There is no rendering code to maintain — you describe what you want, the runtime draws it.",
  },
  {
    name: "Typed and safe",
    body: "Every binding is checked against your live data. Point an island at a field that doesn't exist and the build fails, naming the island — never a silently wrong chart.",
  },
  {
    name: "Local-first",
    body: "Your files are the source of truth. The runtime queries them live on every request, so there are no snapshots to drift out of date.",
  },
  {
    name: "Agent-native",
    body: "A CLI and an MCP server give an agent a typed, diffed, reversible way to edit the app — so it can keep your dashboard healthy for months.",
  },
];

const loopSteps = [
  { name: "read", body: "Pull the manifest, the island schemas, and a slice of the live data." },
  { name: "propose", body: "Submit a full-manifest edit; it's validated against the data before a byte is written." },
  { name: "diff", body: "See exactly what changes. Nothing is written yet." },
  { name: "apply", body: "Write it, snapshotting the prior version as a checkpoint." },
  { name: "rollback", body: "Restore any checkpoint, byte for byte, if something looks off." },
];

/**
 * The documentation landing page. The hero uses Vocs' own HomePage primitives
 * so it inherits the site theme; the sections below are themed with the Vocs
 * color variables (which resolve against the docs' forced dark scheme) and carry
 * the one idea worth proving on a marketing page: a manifest on the left renders,
 * live, into a real island on the right — drawn by the same runtime renderer the
 * docs and a production dashboard share.
 */
export function Home() {
  return (
    <div className="oi-home">
      <HomePage.Root className="oi-hero">
        <HomePage.Logo />
        <HomePage.Tagline>
          Dashboards an agent can maintain for months — without them rotting.
        </HomePage.Tagline>
        <HomePage.Description>
          OpenIslands is a local-first runtime for agent-maintained data apps. You bind typed
          islands to your own files in a manifest, and never touch rendering code.
        </HomePage.Description>
        <HomePage.Buttons>
          <HomePage.Button href="/getting-started" variant="accent">
            Get started
          </HomePage.Button>
          <HomePage.Button href="/introduction">Introduction</HomePage.Button>
          <HomePage.Button href={GITHUB_URL}>GitHub</HomePage.Button>
        </HomePage.Buttons>
        <CopyCommand command="npx openislands init my-dashboard" />
      </HomePage.Root>

      <section className="oi-section">
        <p className="oi-eyebrow">the whole idea</p>
        <h2 className="oi-section-title">
          You write the manifest. The runtime renders the island.
        </h2>
        <div className="oi-split">
          <figure className="oi-panel oi-panel-code">
            <figcaption className="oi-panel-head" translate="no">
              app/manifest.json
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
              <span className="oi-live-badge">live</span>
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
          That tile is live — the same renderer that ships in the runtime, drawn right here from
          the data the manifest points at. Not a screenshot.
        </p>
        <figure className="oi-panel oi-panel-live oi-panel-wide">
          <figcaption className="oi-panel-head">
            <span translate="no">timeseries.line</span>
            <span className="oi-live-badge">live</span>
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
          The MCP server is read-many, write-one. Every change runs the same path, and every
          write is reversible — so an agent can maintain the app without ever leaving it broken.
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
        <HomePage.Buttons>
          <HomePage.Button href="/getting-started" variant="accent">
            Get started
          </HomePage.Button>
          <HomePage.Button href={GITHUB_URL}>GitHub</HomePage.Button>
        </HomePage.Buttons>
        <p className="oi-meta" translate="no">
          MIT · local-first · npx openislands · MCP
        </p>
      </section>
    </div>
  );
}

export default Home;
