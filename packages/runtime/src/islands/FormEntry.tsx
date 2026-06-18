import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banner, Button, Checkbox, Input, Select, SkeletonLine, Text } from "@cloudflare/kumo";
import type { ActionField } from "@openislands/compiler";
import { useAppId } from "../client/useAppId.js";
import { invalidateDatasets } from "../client/useLiveUpdates.js";
import type { IslandConfig, IslandRenderProps } from "../types.js";

interface ActionForm {
  action: string;
  dataset: string;
  fields: ActionField[];
}

type FieldValue = string | boolean;
type FormState = Record<string, FieldValue>;

/** A submit failure, split into per-field messages (shown inline) and a general message (shown as a banner). */
interface SubmitError {
  message?: string;
  fields: Record<string, string>;
}

function initialState(fields: ActionField[]): FormState {
  const state: FormState = {};
  for (const field of fields) {
    if (field.type === "boolean") state[field.name] = field.default === true;
    else state[field.name] = field.default === undefined ? "" : String(field.default);
  }
  return state;
}

/**
 * Coerce the input values into a row, dropping blanks: a blank field with a
 * default falls back to it, and a blank required field is omitted so the server
 * rejects it with a named "required" error rather than a confusing type error.
 */
function toRow(fields: ActionField[], state: FormState): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.type === "boolean") {
      row[field.name] = state[field.name] === true;
      continue;
    }
    const value = state[field.name];
    const text = typeof value === "string" ? value.trim() : "";
    if (text === "") continue;
    row[field.name] = field.type === "number" ? Number(text) : text;
  }
  return row;
}

/** The fields to render, honoring an optional `fields` subset/order on the island config. */
function visibleFields(form: ActionForm, config: IslandConfig): ActionField[] {
  const order = Array.isArray(config.fields) ? (config.fields as string[]) : null;
  if (!order) return form.fields;
  const byName = new Map(form.fields.map((field) => [field.name, field]));
  return order.map((name) => byName.get(name)).filter((field): field is ActionField => field !== undefined);
}

function labelFor(field: ActionField): string {
  return field.name.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

async function fetchForm(appId: string, action: string): Promise<ActionForm> {
  const res = await fetch(`/api/action?app=${encodeURIComponent(appId)}&action=${encodeURIComponent(action)}`, {
    headers: { accept: "application/json" },
  });
  const body = (await res.json()) as ActionForm | { error: string };
  if (!res.ok || "error" in body) {
    throw new Error("error" in body ? body.error : `failed to load form (${res.status})`);
  }
  return body;
}

type SubmitResponse =
  | { ok: true }
  | { ok: false; error?: string; errors?: { row: number; field: string; message: string }[] };

async function postRow(appId: string, action: string, row: Record<string, unknown>): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/action?app=${encodeURIComponent(appId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, row }),
    });
  } catch {
    throw { fields: {}, message: "Couldn't reach the server." } as SubmitError;
  }
  const body = (await res.json().catch(() => ({ ok: false }))) as SubmitResponse;
  if (res.ok && body.ok) return;
  const error: SubmitError = { fields: {} };
  if (!body.ok) {
    if (body.error) error.message = body.error;
    for (const issue of body.errors ?? []) {
      if (issue.field && issue.field !== "(row)") error.fields[issue.field] = issue.message;
      else error.message = issue.message;
    }
  }
  if (error.message === undefined && Object.keys(error.fields).length === 0) error.message = "Couldn't save.";
  throw error;
}

function Field({
  field,
  value,
  error,
  onChange,
}: {
  field: ActionField;
  value: FieldValue;
  error?: string;
  onChange: (value: FieldValue) => void;
}) {
  const label = labelFor(field);
  const text = typeof value === "string" ? value : "";

  if (field.type === "boolean") {
    return (
      <div className="flex flex-col gap-1">
        <Checkbox label={label} checked={value === true} onCheckedChange={(checked) => onChange(checked === true)} />
        {error ? <FieldError message={error} /> : null}
      </div>
    );
  }

  if (field.enum && field.enum.length > 0) {
    return (
      <div className="flex flex-col gap-1">
        <Select label={label} value={text} onValueChange={(next) => onChange(typeof next === "string" ? next : "")}>
          {field.enum.map((option) => (
            <Select.Option key={option} value={option}>
              {option}
            </Select.Option>
          ))}
        </Select>
        {error ? <FieldError message={error} /> : null}
      </div>
    );
  }

  const inputType = field.type === "number" ? "number" : field.type === "date" ? "date" : "text";
  return (
    <Input
      label={label}
      type={inputType}
      value={text}
      min={field.min}
      max={field.max}
      placeholder={field.description}
      error={error}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function FieldError({ message }: { message: string }) {
  return (
    <Text variant="secondary" size="xs" DANGEROUS_className="text-kumo-danger">
      {message}
    </Text>
  );
}

function FormBody({ form, config }: { form: ActionForm; config: IslandConfig }) {
  const appId = useAppId();
  const queryClient = useQueryClient();
  const fields = useMemo(() => visibleFields(form, config), [form, config]);
  const [state, setState] = useState<FormState>(() => initialState(fields));
  const [done, setDone] = useState(false);
  const submitLabel = typeof config.submitLabel === "string" ? config.submitLabel : "Add";

  const mutation = useMutation<void, SubmitError>({
    mutationFn: () => postRow(appId, form.action, toRow(fields, state)),
    onSuccess: () => {
      setState(initialState(fields));
      setDone(true);
      invalidateDatasets(queryClient, [form.dataset], appId);
    },
  });

  if (fields.length === 0) {
    return (
      <Text variant="secondary" size="sm">
        This form has no fields to fill — its action targets a dataset with no columns yet.
      </Text>
    );
  }

  const setField = (name: string, value: FieldValue) => {
    setState((prev) => ({ ...prev, [name]: value }));
    if (done) setDone(false);
  };

  const error = mutation.error ?? undefined;

  return (
    <form
      className="flex h-full min-w-0 flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setDone(false);
        mutation.mutate();
      }}
    >
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
        {fields.map((field) => (
          <Field
            key={field.name}
            field={field}
            value={state[field.name] ?? ""}
            error={error?.fields[field.name]}
            onChange={(value) => setField(field.name, value)}
          />
        ))}
      </div>
      {error?.message ? <Banner variant="error" description={error.message} /> : null}
      <div className="flex items-center justify-end gap-2 pt-1">
        {done && !mutation.isPending ? (
          <Text variant="secondary" size="sm" DANGEROUS_className="text-kumo-success">
            Added
          </Text>
        ) : null}
        <Button type="submit" variant="primary" size="sm" loading={mutation.isPending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/**
 * A data-entry form bound to a manifest `action`. Fetches the action's resolved
 * field schema (the same descriptors `run_action` validates against), renders a
 * typed input per field, and POSTs the row to `/api/action` — the human mirror
 * of the agent's `run_action`. On success it refreshes the bound dataset's
 * islands so the new row shows up live.
 */
export function FormEntry({ config }: IslandRenderProps) {
  const appId = useAppId();
  const action = typeof config.action === "string" ? config.action : "";

  const formQuery = useQuery({
    queryKey: ["action-form", appId, action],
    queryFn: () => fetchForm(appId, action),
    enabled: Boolean(action),
    staleTime: 30_000,
  });

  if (!action) {
    return <Banner variant="error" description="form.entry needs an 'action'." />;
  }
  if (formQuery.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <SkeletonLine />
        <SkeletonLine />
        <SkeletonLine minWidth={30} maxWidth={45} />
      </div>
    );
  }
  if (formQuery.isError || !formQuery.data) {
    const message = formQuery.error instanceof Error ? formQuery.error.message : "Couldn't load this form.";
    return <Banner variant="error" description={message} />;
  }

  return <FormBody form={formQuery.data} config={config} />;
}
