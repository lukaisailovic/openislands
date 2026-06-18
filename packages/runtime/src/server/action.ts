import {
  ActionValidationError,
  actionFields,
  insertRows,
  readManifest,
  type ActionField,
  type RowError,
} from "@openislands/compiler";

/** The resolved form for an action: the fields a `form.entry` island renders, and the dataset a submit writes to. */
export interface ActionForm {
  action: string;
  dataset: string;
  fields: ActionField[];
}

export interface ActionFormResult {
  status: number;
  body: ActionForm | { error: string };
}

/**
 * Resolve an action's form schema for rendering — its target dataset and one
 * descriptor per insertable field (type, enum, range, default), derived live the
 * same way `run_action`'s row schema is. Returns a structured result (not a
 * Response) so the route and unit tests share one path, like the query handler.
 */
export async function resolveActionForm(projectDir: string, action: string): Promise<ActionFormResult> {
  if (!action) return { status: 400, body: { error: "missing 'action'" } };
  try {
    const manifest = await readManifest(projectDir);
    const spec = manifest.actions?.[action];
    if (!spec) return { status: 404, body: { error: `unknown action '${action}'` } };
    return { status: 200, body: { action, dataset: spec.dataset, fields: await actionFields(projectDir, action) } };
  } catch (err) {
    return { status: 422, body: { error: err instanceof Error ? err.message : String(err) } };
  }
}

export interface ActionSubmitResult {
  status: number;
  body: { ok: true; inserted: number; checkpoint_id: string } | { ok: false; error?: string; errors?: RowError[] };
}

/**
 * Insert one row through an action — the human-facing mirror of the MCP
 * `run_action`, sharing `insertRows` so row validation, the history snapshot,
 * and the write itself are identical. A field-level failure returns the
 * per-field errors; any other failure (unknown action, unwritable dataset)
 * returns its message. Nothing is written unless every field validates.
 */
export async function submitAction(projectDir: string, payload: unknown): Promise<ActionSubmitResult> {
  const { action, row } = (payload ?? {}) as { action?: unknown; row?: unknown };
  if (typeof action !== "string" || !action) return { status: 400, body: { ok: false, error: "missing 'action'" } };
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    return { status: 400, body: { ok: false, error: "'row' must be an object" } };
  }
  try {
    const { inserted, checkpoint_id } = await insertRows(projectDir, action, [row]);
    return { status: 200, body: { ok: true, inserted, checkpoint_id } };
  } catch (err) {
    if (err instanceof ActionValidationError) return { status: 422, body: { ok: false, errors: err.errors } };
    return { status: 422, body: { ok: false, error: err instanceof Error ? err.message : String(err) } };
  }
}
