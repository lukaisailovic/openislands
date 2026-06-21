import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalAppStateStore, LocalContentStore } from "@openislands/storage";
import { describe, expect, it } from "vitest";
import { createCheckpointStore } from "../src/checkpoints.js";

function store() {
  const root = mkdtempSync(join(tmpdir(), "oi-ckpt-"));
  const appState = new LocalAppStateStore(root);
  return { root, appState, checkpoints: createCheckpointStore(root, appState, new LocalContentStore(root)) };
}

describe("checkpoint store prune", () => {
  it("keeps the newest N ids across both manifest and data checkpoints, deleting the rest by their real keys", async () => {
    const { appState, checkpoints } = store();
    // Manifest checkpoints live under `<id>.json`; data checkpoints under the id verbatim.
    await appState.put("history/ckpt-1.json", "a");
    await appState.put("history/ckpt-2.json", "b");
    await appState.put("history/ckpt-3!data%2Fx.csv", "c");
    await appState.put("history/ckpt-4.json", "d");
    expect(await checkpoints.list()).toEqual(["ckpt-1", "ckpt-2", "ckpt-3!data%2Fx.csv", "ckpt-4"]);

    const result = await checkpoints.prune(2);
    expect(result).toEqual({ kept: 2, removed: 2 });
    expect(await checkpoints.list()).toEqual(["ckpt-3!data%2Fx.csv", "ckpt-4"]);
    // the manifest checkpoint was removed at its `.json` key, not its bare id
    expect(await appState.exists("history/ckpt-1.json")).toBe(false);
    expect(await appState.exists("history/ckpt-2.json")).toBe(false);
  });

  it("is a no-op when keep exceeds the count", async () => {
    const { appState, checkpoints } = store();
    await appState.put("history/ckpt-1.json", "a");
    expect(await checkpoints.prune(25)).toEqual({ kept: 1, removed: 0 });
    expect(await checkpoints.list()).toEqual(["ckpt-1"]);
  });
});
