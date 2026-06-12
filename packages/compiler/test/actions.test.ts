import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  actionRowSchema,
  appendRows,
  ActionValidationError,
  query,
  resetEngine,
} from "../src/index.js";

const projects: string[] = [];
afterEach(() => {
  for (const dir of projects.splice(0)) resetEngine(dir);
});

function project(manifest: unknown, files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "oi-act-"));
  mkdirSync(join(dir, "app"), { recursive: true });
  mkdirSync(join(dir, "data"), { recursive: true });
  writeFileSync(join(dir, "app", "manifest.json"), JSON.stringify(manifest));
  for (const [path, content] of Object.entries(files)) writeFileSync(join(dir, path), content);
  projects.push(dir);
  return dir;
}

function manifestWith(actions: Record<string, unknown>, source = "data/meals.csv") {
  return {
    version: 1,
    title: "T",
    datasets: { meals: { source } },
    pages: [{ id: "p", islands: [{ type: "table.grid", title: "Meals", dataset: "meals" }] }],
    actions,
  };
}

const MEALS_CSV = "name,kcal,logged\nOatmeal,300,2026-01-01\n";

describe("actionRowSchema", () => {
  it("derives column types from the CSV", async () => {
    const dir = project(manifestWith({ log_meal: { dataset: "meals", mode: "append" } }), {
      "data/meals.csv": MEALS_CSV,
    });
    const schema = await actionRowSchema(dir, "log_meal");
    expect(schema.safeParse({ name: "Eggs", kcal: 200, logged: "2026-02-02" }).success).toBe(true);
    expect(schema.safeParse({ name: "Eggs", kcal: "lots", logged: "2026-02-02" }).success).toBe(false);
    expect(schema.safeParse({ name: "Eggs", kcal: 200, logged: "not-a-date" }).success).toBe(false);
  });

  it("applies enum, min/max, and default overrides", async () => {
    const dir = project(
      manifestWith({
        log_meal: {
          dataset: "meals",
          mode: "append",
          fields: {
            name: { enum: ["Eggs", "Oatmeal"] },
            kcal: { type: "number", min: 0, max: 1000 },
            logged: { default: "2026-01-01" },
          },
        },
      }),
      { "data/meals.csv": MEALS_CSV },
    );
    const schema = await actionRowSchema(dir, "log_meal");
    expect(schema.safeParse({ name: "Sushi", kcal: 200, logged: "2026-02-02" }).success).toBe(false);
    expect(schema.safeParse({ name: "Eggs", kcal: 5000, logged: "2026-02-02" }).success).toBe(false);

    const filled = schema.parse({ name: "Eggs", kcal: 200 });
    expect(filled.logged).toBe("2026-01-01");
  });

  it("rejects unknown keys (strict)", async () => {
    const dir = project(manifestWith({ log_meal: { dataset: "meals", mode: "append" } }), {
      "data/meals.csv": MEALS_CSV,
    });
    const schema = await actionRowSchema(dir, "log_meal");
    expect(schema.safeParse({ name: "Eggs", kcal: 200, logged: "2026-02-02", extra: 1 }).success).toBe(false);
  });

  it("throws on an unknown action", async () => {
    const dir = project(manifestWith({ log_meal: { dataset: "meals", mode: "append" } }), {
      "data/meals.csv": MEALS_CSV,
    });
    await expect(actionRowSchema(dir, "nope")).rejects.toThrow(/unknown action/);
  });

  it("throws on a fields key that is not a dataset column", async () => {
    const dir = project(
      manifestWith({ log_meal: { dataset: "meals", mode: "append", fields: { protein: { type: "number" } } } }),
      { "data/meals.csv": MEALS_CSV },
    );
    await expect(actionRowSchema(dir, "log_meal")).rejects.toThrow(/protein/);
  });
});

describe("appendRows (CSV)", () => {
  it("appends rows preserving header order and quoting", async () => {
    const dir = project(manifestWith({ log_meal: { dataset: "meals", mode: "append" } }), {
      "data/meals.csv": MEALS_CSV,
    });
    const result = await appendRows(dir, "log_meal", [
      { kcal: 250, logged: "2026-02-02", name: "Salad, fresh" },
    ]);
    expect(result.appended).toBe(1);

    const text = readFileSync(join(dir, "data/meals.csv"), "utf8");
    expect(text).toBe('name,kcal,logged\nOatmeal,300,2026-01-01\n"Salad, fresh",250,2026-02-02\n');
  });

  it("is all-or-nothing: a bad row throws ActionValidationError and leaves the file byte-identical", async () => {
    const dir = project(manifestWith({ log_meal: { dataset: "meals", mode: "append" } }), {
      "data/meals.csv": MEALS_CSV,
    });
    const before = readFileSync(join(dir, "data/meals.csv"));

    const err = await appendRows(dir, "log_meal", [
      { name: "Eggs", kcal: 200, logged: "2026-02-02" },
      { name: "Bad", kcal: "lots", logged: "2026-02-03" },
    ]).catch((e) => e);

    expect(err).toBeInstanceOf(ActionValidationError);
    expect((err as ActionValidationError).errors).toContainEqual(
      expect.objectContaining({ row: 1, field: "kcal" }),
    );
    expect(readFileSync(join(dir, "data/meals.csv"))).toEqual(before);
  });

  it("keeps a malicious value as a single CSV cell (injection fixture)", async () => {
    const dir = project(manifestWith({ log_meal: { dataset: "meals", mode: "append" } }), {
      "data/meals.csv": MEALS_CSV,
    });
    await appendRows(dir, "log_meal", [
      { name: '"x","y"\nINJECTED', kcal: 1, logged: "2026-02-02" },
      { name: "=cmd()", kcal: 2, logged: "2026-02-03" },
    ]);

    resetEngine(dir);
    const out = await query(dir, "meals");
    expect(out.rows).toContainEqual({ name: '"x","y"\nINJECTED', kcal: 1, logged: "2026-02-02" });
    expect(out.rows).toContainEqual({ name: "=cmd()", kcal: 2, logged: "2026-02-03" });
    expect(out.rows).toHaveLength(3);
  });

  it("appended rows are visible to a subsequent query after resetEngine", async () => {
    const dir = project(manifestWith({ log_meal: { dataset: "meals", mode: "append" } }), {
      "data/meals.csv": MEALS_CSV,
    });
    await appendRows(dir, "log_meal", [{ name: "Eggs", kcal: 200, logged: "2026-02-02" }]);
    resetEngine(dir);
    const out = await query(dir, "meals");
    expect(out.rows).toHaveLength(2);
    expect(out.rows[1]).toEqual({ name: "Eggs", kcal: 200, logged: "2026-02-02" });
  });
});

describe("appendRows (JSONL)", () => {
  it("appends one JSON line per row", async () => {
    const dir = project(manifestWith({ log: { dataset: "meals", mode: "append" } }, "data/meals.ndjson"), {
      "data/meals.ndjson": '{"name":"Oatmeal","kcal":300}\n',
    });
    await appendRows(dir, "log", [
      { name: "Eggs", kcal: 200 },
      { name: "Toast", kcal: 150 },
    ]);
    const text = readFileSync(join(dir, "data/meals.ndjson"), "utf8");
    expect(text).toBe(
      '{"name":"Oatmeal","kcal":300}\n{"name":"Eggs","kcal":200}\n{"name":"Toast","kcal":150}\n',
    );
  });
});

function historyFiles(dir: string): string[] {
  return readdirSync(join(dir, ".openislands", "history"));
}

describe("appendRows (snapshots + retention)", () => {
  it("writes a snapshot named by the checkpoint id matching the pre-append bytes", async () => {
    const dir = project(manifestWith({ log_meal: { dataset: "meals", mode: "append" } }), {
      "data/meals.csv": MEALS_CSV,
    });
    const before = readFileSync(join(dir, "data/meals.csv"));
    const { checkpoint_id } = await appendRows(dir, "log_meal", [{ name: "Eggs", kcal: 200, logged: "2026-02-02" }]);

    expect(checkpoint_id).toContain("!");
    const snapshot = readFileSync(join(dir, ".openislands", "history", checkpoint_id));
    expect(snapshot).toEqual(before);
  });

  it("prunes oldest snapshots beyond the count cap", async () => {
    const dir = project(manifestWith({ log_meal: { dataset: "meals", mode: "append" } }), {
      "data/meals.csv": MEALS_CSV,
    });
    for (let i = 0; i < 5; i += 1) {
      await appendRows(dir, "log_meal", [{ name: `M${i}`, kcal: i, logged: "2026-02-02" }], {
        maxSnapshots: 2,
      });
    }
    expect(historyFiles(dir)).toHaveLength(2);
  });
});
