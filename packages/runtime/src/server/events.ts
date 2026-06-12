import type { RuntimeEvent } from "../types.js";
import { broadcasterFor, ensureWatcher } from "./watcher.js";

/** Serialize a runtime event as an SSE frame. */
export function formatEvent(event: RuntimeEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * The SSE response body: it opens the stream, holds it with a heartbeat, and
 * forwards every runtime event the file watcher publishes through the
 * broadcaster. Each open EventSource gets its own subscription, dropped when
 * the client disconnects.
 */
export function createEventStream(appId: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;
  ensureWatcher(appId);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(": connected\n\n"));
      unsubscribe = broadcasterFor(appId).subscribe((event) =>
        controller.enqueue(encoder.encode(formatEvent(event))),
      );
      heartbeat = setInterval(() => controller.enqueue(encoder.encode(": ping\n\n")), 15_000);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      if (unsubscribe) unsubscribe();
    },
  });
}

export const SSE_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
} as const;
