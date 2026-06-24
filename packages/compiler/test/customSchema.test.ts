import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compile, resetCustomSchemaCache, resetEngine } from "../src/index.js";

const projects: string[] = [];
afterEach(() => {
  for (const dir of projects.splice(0)) resetEngine(dir);
  resetCustomSchemaCache();
});

const GAUGE_SCHEMA = `import { z } from "zod";
export default z.object({
  type: z.literal("gauge.ring"),
  dataset: z.string(),
  rings: z.array(z.object({ value: z.string(), max: z.union([z.string(), z.number()]) })).min(1),
});
`;

function project(manifest: unknown, opts?: { schema?: string }): string {
  const dir = mkdtempSync(join(tmpdir(), "oi-custom-"));
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "data"), { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  writeFileSync(join(dir, "data", "m.csv"), "protein_g,protein_goal_g\n100,120\n");
  if (opts?.schema !== undefined) {
    const sdir = join(dir, "components", "custom", "gauge.ring");
    mkdirSync(sdir, { recursive: true });
    writeFileSync(join(sdir, "schema.ts"), opts.schema);
  }
  projects.push(dir);
  return dir;
}

function gaugeManifest(rings: unknown) {
  return {
    version: 1,
    title: "T",
    datasets: { m: { source: "data/m.csv" } },
    pages: [{ id: "today", islands: [{ type: "gauge.ring", dataset: "m", rings }] }],
  };
}

describe("custom island schema validation", () => {
  it("passes a valid custom config against its schema.ts", async () => {
    const dir = project(gaugeManifest([{ value: "protein_g", max: "protein_goal_g" }]), {
      schema: GAUGE_SCHEMA,
    });
    const report = await compile(dir);
    expect(report.ok).toBe(true);
  });

  it("fails a bad custom config, naming page/index/type/field", async () => {
    const dir = project(gaugeManifest([{ max: "protein_goal_g" }]), { schema: GAUGE_SCHEMA });
    const report = await compile(dir);
    expect(report.ok).toBe(false);
    const err = report.manifestErrors.find((e) => e.type === "gauge.ring");
    expect(err).toBeDefined();
    expect(err!.page).toBe("today");
    expect(err!.index).toBe(0);
    expect(err!.field).toContain("rings");
  });

  it("accepts a custom island unchecked when no schema file exists", async () => {
    const dir = project(gaugeManifest("anything goes"));
    const report = await compile(dir);
    expect(report.ok).toBe(true);
  });

  it("fails loudly when the schema file has no Zod default export", async () => {
    const dir = project(gaugeManifest([{ value: "protein_g", max: 100 }]), {
      schema: `export default 42;\n`,
    });
    const report = await compile(dir);
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.includes("schema is broken"))).toBe(true);
  });
});
