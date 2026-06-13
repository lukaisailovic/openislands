/**
 * Type surface for the framework-built SSR server bundle (`dist/server/server.js`).
 * The bundle is produced by `vite build` and ships no declarations, so this
 * hand-written shape backs the `./server` export's `types` condition. The default
 * export is the fetch handler the CLI drives in `serve`.
 */
declare const server: {
  fetch: (request: Request) => Response | Promise<Response>;
};

export default server;
