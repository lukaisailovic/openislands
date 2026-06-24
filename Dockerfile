# syntax=docker/dockerfile:1.7
#
# One image, one process: the dashboard runtime AND the MCP server, served on a
# single port. Build the workspace, then serve a project mounted at /project
# (a single app or a workspace of apps — `serve` auto-detects which).
#
#   docker build -t openislands .
#   # dashboard + MCP (the default): a token is required when binding off-loopback
#   docker run --rm -p 127.0.0.1:4321:4321 \
#     -e OPENISLANDS_MCP_TOKEN="$(openssl rand -hex 32)" \
#     -v "$PWD/my-dashboard:/project" openislands
#   # dashboard only, no token:
#   docker run --rm -p 127.0.0.1:4321:4321 -e OPENISLANDS_MCP=0 \
#     -v "$PWD/my-dashboard:/project" openislands
#
# The container binds 0.0.0.0 so the published port is reachable. MCP is a write
# surface (apply_edit / run_action), so when it's on (the default) and bound off
# loopback, serve refuses to start without OPENISLANDS_MCP_TOKEN — set the token,
# or set OPENISLANDS_MCP=0 for a dashboard-only container. See /self-hosting.
# Set OPENISLANDS_ALLOWED_IPS (comma-separated IPs / IPv4 CIDRs) to restrict which
# client IPs may connect once the port is exposed off loopback (default: all).
#
# DuckDB ships glibc-only native bindings, so the base image must be glibc
# (node:22-slim / Debian), never alpine/musl.

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-slim AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY templates ./templates
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
# Build only the packages (the image never serves apps/docs, which the root `build`
# script excludes by name — but .dockerignore drops apps/ from the build context, so
# that negative filter would fail on the absent package). turbo resolves the dep order.
RUN pnpm turbo run build --filter='./packages/*'

FROM node:${NODE_VERSION}-slim AS runtime
LABEL org.opencontainers.image.title="openislands" \
      org.opencontainers.image.description="Self-hosted dashboard runtime + MCP server (Streamable HTTP) for agent-maintained data apps, in one process" \
      org.opencontainers.image.source="https://github.com/lukaisailovic/openislands" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app

# Defaults baked in so `docker run` needs no flags. Flags still win over env if you
# pass them; OPENISLANDS_MCP_TOKEN is read from the environment at runtime.
ENV NODE_ENV=production \
    OPENISLANDS_HOST=0.0.0.0 \
    OPENISLANDS_PORT=4321 \
    OPENISLANDS_MCP=1

COPY --from=build /app /app

EXPOSE 4321

# Probe the always-on /healthz route (served before any runtime route), so the
# check doesn't depend on a manifest being present or valid.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4321/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

# Run as the built-in non-root `node` user (uid 1000). The mounted /project must be
# writable by uid 1000 — serve writes app state under .openislands/ there.
USER node

# Run through tsx like the repo's own `oi`/`demo` scripts: the workspace `exports`
# resolve to TypeScript source, so the CLI must be loaded by tsx, not plain node.
# Host / port / MCP come from the ENV defaults above (OPENISLANDS_HOST=0.0.0.0 etc).
ENTRYPOINT ["node_modules/.bin/tsx", "packages/cli/src/index.ts", "serve", "/project"]
CMD []
