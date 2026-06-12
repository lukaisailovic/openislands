import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectorStatus } from "@openislands/compiler";
import { AppIdContext } from "../src/client/useAppId.js";
import {
  ConnectionsDialog,
  relativeTime,
  statusBadge,
} from "../src/components/ConnectionsDialog.js";

const base: ConnectorStatus = {
  name: "whoop",
  module: "connectors/whoop",
  datasets: { recovery: "whoop_recovery" },
  auth: "oauth2",
  connected: false,
  missingSecrets: [],
};

describe("statusBadge", () => {
  it("is success when connected", () => {
    expect(statusBadge({ ...base, connected: true })).toEqual({
      variant: "success",
      label: "Connected",
    });
  });

  it("is neutral when not connected", () => {
    expect(statusBadge(base).variant).toBe("neutral");
  });

  it("is error when the last sync failed", () => {
    expect(statusBadge({ ...base, connected: true, lastError: "boom" }).variant).toBe("error");
  });

  it("is error when the module failed to load", () => {
    expect(statusBadge({ ...base, loadError: "bad import" })).toEqual({
      variant: "error",
      label: "Load error",
    });
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-06-12T12:00:00Z");

  it("renders hours ago", () => {
    expect(relativeTime("2026-06-12T09:00:00Z", now)).toBe("3 hours ago");
  });

  it("renders days ago", () => {
    expect(relativeTime("2026-06-10T12:00:00Z", now)).toBe("2 days ago");
  });

  it("falls back to the raw value for an unparseable date", () => {
    expect(relativeTime("nope", now)).toBe("nope");
  });
});

function mockStatuses(statuses: ConnectorStatus[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(statuses), { status: 200 })),
  );
}

function openDialog() {
  render(
    <AppIdContext.Provider value="health">
      <ConnectionsDialog trigger={<button type="button">open</button>} />
    </AppIdContext.Provider>,
  );
  fireEvent.click(screen.getByText("open"));
}

describe("ConnectionsDialog", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "EventSource",
      class {
        addEventListener() {}
        close() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lists a connected connector with its last-synced time", async () => {
    mockStatuses([
      { ...base, connected: true, lastSync: new Date(Date.now() - 3_600_000).toISOString() },
    ]);
    openDialog();
    expect(await screen.findByText("whoop")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText(/Last synced/)).toBeInTheDocument();
    expect(screen.queryByText("Connect")).not.toBeInTheDocument();
  });

  it("shows a Connect button for a disconnected oauth2 connector", async () => {
    mockStatuses([base]);
    openDialog();
    await screen.findByText("Connect");
    const link = document.querySelector('a[href="/api/connectors/whoop/auth/start?app=health"]');
    expect(link).not.toBeNull();
    expect(link).toHaveTextContent("Connect");
    expect(screen.getByText("Not connected")).toBeInTheDocument();
  });

  it("surfaces an error and a missing-secrets hint", async () => {
    mockStatuses([
      { ...base, lastError: "token expired", missingSecrets: ["WHOOP_CLIENT_SECRET"] },
    ]);
    openDialog();
    expect(await screen.findByText("token expired")).toBeInTheDocument();
    expect(screen.getByText(/WHOOP_CLIENT_SECRET/)).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("hides Connect when client secrets are missing", async () => {
    mockStatuses([{ ...base, missingSecrets: ["WHOOP_CLIENT_ID", "WHOOP_CLIENT_SECRET"] }]);
    openDialog();
    await screen.findByText("whoop");
    expect(screen.queryByText("Connect")).not.toBeInTheDocument();
  });

  it("posts a sync when Sync now is clicked", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Response(
          JSON.stringify({ connector: "whoop", datasets: {}, durationMs: 1 }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify([{ ...base, connected: true }]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    openDialog();
    const syncButton = await screen.findByText("Sync now");
    fireEvent.click(syncButton);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/connectors/whoop/sync?app=health", {
        method: "POST",
      }),
    );
  });
});
