import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetEngine } from "@openislands/compiler";
import { resolveActionForm, submitAction } from "../src/server/action.js";

const projects: string[] = [];
afterEach(() => {
  for (const dir of projects.splice(0)) resetEngine(dir);
});

const MEALS_CSV = "name,kcal,logged\nOatmeal,300,2026-01-01\n";

function manifestWith(actions: Record<string, unknown>) {
  return {
    version: 1,
    title: "T",
    datasets: { meals: { source: "data/meals.csv" } },
    pages: [{ id: "p", islands: [{ type: "form.entry", action: "log_meal" }] }],
    actions,
  };
}

function project(actions: Record<string, unknown>, files: Record<string, string> = { "data/meals.csv": MEALS_CSV }): string {
  const dir = mkdtempSync(join(tmpdir(), "oi-rt-action-"));
  mkdirSync(join(dir, "app"), { recursive: true });
  mkdirSync(join(dir, "data"), { recursive: true });
  writeFileSync(join(dir, "app", "manifest.json"), JSON.stringify(manifestWith(actions)));
  for (const [path, content] of Object.entries(files)) writeFileSync(join(dir, path), content);
  projects.push(dir);
  return dir;
}

const ENUM_ACTION = {
  log_meal: {
    dataset: "meals",
    mode: "insert",
    fields: { name: { enum: ["Eggs", "Oatmeal"] }, kcal: { type: "number", min: 0, max: 1000 } },
  },
};

describe("resolveActionForm", () => {
  it("returns 200 with the action's dataset and field descriptors", async () => {
    const dir = project(ENUM_ACTION);
    const result = await resolveActionForm(dir, "log_meal");
    expect(result.status).toBe(200);
    const body = result.body as { action: string; dataset: string; fields: { name: string; type: string; enum?: string[] }[] };
    expect(body.action).toBe("log_meal");
    expect(body.dataset).toBe("meals");
    expect(body.fields.map((f) => f.name)).toEqual(["name", "kcal", "logged"]);
    const name = body.fields.find((f) => f.name === "name")!;
    expect(name.enum).toEqual(["Eggs", "Oatmeal"]);
  });

  it("returns 400 for a missing action", async () => {
    const dir = project(ENUM_ACTION);
    expect((await resolveActionForm(dir, "")).status).toBe(400);
  });

  it("returns 404 for an unknown action", async () => {
    const dir = project(ENUM_ACTION);
    const result = await resolveActionForm(dir, "ghost");
    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: "unknown action 'ghost'" });
  });
});

describe("submitAction", () => {
  it("inserts a valid row and reports it", async () => {
    const dir = project(ENUM_ACTION);
    const result = await submitAction(dir, { action: "log_meal", row: { name: "Eggs", kcal: 200, logged: "2026-02-02" } });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, inserted: 1 });

    const text = readFileSync(join(dir, "data/meals.csv"), "utf8");
    expect(text).toBe("name,kcal,logged\nOatmeal,300,2026-01-01\nEggs,200,2026-02-02\n");
  });

  it("returns 422 with field errors for an enum violation and writes nothing", async () => {
    const dir = project(ENUM_ACTION);
    const before = readFileSync(join(dir, "data/meals.csv"));
    const result = await submitAction(dir, { action: "log_meal", row: { name: "Sushi", kcal: 200, logged: "2026-02-02" } });
    expect(result.status).toBe(422);
    const body = result.body as { ok: false; errors?: { field: string }[] };
    expect(body.ok).toBe(false);
    expect(body.errors!.some((e) => e.field === "name")).toBe(true);
    expect(readFileSync(join(dir, "data/meals.csv"))).toEqual(before);
  });

  it("returns 422 with field errors for a missing required field", async () => {
    const dir = project({ log_meal: { dataset: "meals", mode: "insert" } });
    const result = await submitAction(dir, { action: "log_meal", row: { name: "Eggs", kcal: 200 } });
    expect(result.status).toBe(422);
    const body = result.body as { ok: false; errors?: { field: string }[] };
    expect(body.ok).toBe(false);
    expect(body.errors!.some((e) => e.field === "logged")).toBe(true);
  });

  it("returns 400 for a missing action", async () => {
    const dir = project(ENUM_ACTION);
    expect((await submitAction(dir, { row: {} })).status).toBe(400);
  });

  it("returns 400 when row is not an object", async () => {
    const dir = project(ENUM_ACTION);
    expect((await submitAction(dir, { action: "log_meal", row: [] })).status).toBe(400);
  });
});
