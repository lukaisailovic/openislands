import type { IslandRenderer } from "../src/islands/registry.js";

/**
 * Resolve a {@link React.lazy} renderer — what the island registry returns now
 * that renderers load on demand — to the component it imports. Drives the same
 * init handshake React uses internally: the first call throws the import
 * promise, so we await it and ask again, getting the resolved default export.
 */
export async function loadLazyRenderer(renderer: IslandRenderer): Promise<unknown> {
  const lazy = renderer as unknown as { _init: (payload: unknown) => unknown; _payload: unknown };
  try {
    return lazy._init(lazy._payload);
  } catch (pending) {
    await pending;
    return lazy._init(lazy._payload);
  }
}
