# OpenIslands for self-hosters: build the workspace, then serve a mounted project.
#
#   docker build -t openislands .
#   docker run --rm -p 4321:4321 -v "$PWD/my-dashboard:/project" openislands
#
# DuckDB ships glibc-only native bindings, so the base image must be glibc
# (node:22-slim / Debian), never alpine/musl.

FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY templates ./templates
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 4321
# Run through tsx like the repo's own `oi`/`demo` scripts: the workspace `exports`
# resolve to TypeScript source, so the CLI must be loaded by tsx, not plain node.
ENTRYPOINT ["node_modules/.bin/tsx", "packages/cli/src/index.ts", "serve", "/project", "--host", "0.0.0.0"]
