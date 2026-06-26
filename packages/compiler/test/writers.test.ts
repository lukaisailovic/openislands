import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalContentStore } from "@openislands/storage";
import { resolveWriter } from "../src/writers.js";

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "oi-writers-"));
  mkdirSync(join(dir, "data"), { recursive: true });
  return dir;
}

describe("appendLines EOL preservation", () => {
  it("preserves CRLF when appending a row to a CRLF CSV", async () => {
    const dir = tempDir();
    const csvPath = "data/meals.csv";
    // Seed a CSV whose every line ending is CRLF
    writeFileSync(join(dir, csvPath), "name,kcal\r\nOatmeal,300\r\n");

    const store = new LocalContentStore(dir);
    const writer = resolveWriter(store, { dataset: "meals", source: csvPath });
    await writer.insert([{ name: "Eggs", kcal: 200 }]);

    const content = readFileSync(join(dir, csvPath), "utf8");
    // The new row must be present
    expect(content).toContain("Eggs");
    // After stripping every \r\n there must be no lone \n left
    expect(content.split("\r\n").join("")).not.toContain("\n");
  });

  it("preserves LF when appending a row to an LF CSV", async () => {
    const dir = tempDir();
    const csvPath = "data/meals.csv";
    writeFileSync(join(dir, csvPath), "name,kcal\nOatmeal,300\n");

    const store = new LocalContentStore(dir);
    const writer = resolveWriter(store, { dataset: "meals", source: csvPath });
    await writer.insert([{ name: "Eggs", kcal: 200 }]);

    const content = readFileSync(join(dir, csvPath), "utf8");
    expect(content).toContain("Eggs");
    // No \r must be introduced
    expect(content).not.toContain("\r");
  });
});
