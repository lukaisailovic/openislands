/**
 * Local-only edit-loop telemetry. Counts the friction the agent hits while maintaining a
 * dashboard — proposals the dry-check rejected, and full manifest rewrites (a resend the
 * patch path was meant to avoid) — into plain files under the app's own `.openislands/`.
 *
 * Strictly fail-safe: every writer swallows its own errors so a telemetry hiccup can never
 * surface in the edit loop. No phone-home, no dashboard — these are local breadcrumbs.
 */
import { type AppStateStore } from "@openislands/storage";
import { type IslandError } from "@openislands/schema";

const REJECTIONS_KEY = "telemetry/rejections.jsonl";
const RESENDS_KEY = "telemetry/manifest_resends";

/** Normalize a dry-check error (an `IslandError` or a bare string) to a flat `{ type?, message }`. */
function normalizeError(error: IslandError | string): { type?: string; message: string } {
  if (typeof error === "string") return { message: error };
  return { type: error.type, message: error.message };
}

/** Append one rejection record (the rejected proposal's errors) to the local JSONL log. */
export async function recordRejection(appState: AppStateStore, errors: (IslandError | string)[]): Promise<void> {
  try {
    const record = { ts: new Date().toISOString(), errors: errors.map(normalizeError) };
    const existing = (await appState.getText(REJECTIONS_KEY)) ?? "";
    await appState.put(REJECTIONS_KEY, existing + JSON.stringify(record) + "\n");
  } catch {
    /* telemetry is best-effort — never break the edit loop */
  }
}

/** Bump the running count of full manifest rewrites (replaceManifest calls). */
export async function recordManifestResend(appState: AppStateStore): Promise<void> {
  try {
    const current = Number.parseInt((await appState.getText(RESENDS_KEY)) ?? "0", 10);
    const next = Number.isFinite(current) ? current + 1 : 1;
    await appState.put(RESENDS_KEY, String(next));
  } catch {
    /* telemetry is best-effort — never break the edit loop */
  }
}
