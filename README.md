# FixNote

Local-first AI note taking desktop app with spatial organization, collaborative
documents and encrypted server persistence.

## Workspace

- `apps/desktop` — React, Vite and Tauri 2 desktop client.
- `apps/api` — NestJS REST API.
- `apps/realtime` — Hocuspocus/Yjs collaboration server.
- `packages/contracts` — shared runtime contracts.
- `packages/database` — Prisma schema and client.
- `packages/crypto` — versioned envelope encryption.
- `packages/sync` — shared Yjs document schemas and room naming.

## Prerequisites

- Node.js 22+
- pnpm 9+
- PostgreSQL with `vector`, `pg_trgm` and `pgcrypto`
- Rust stable MSVC, Microsoft C++ Build Tools and WebView2 for Tauri

Copy `.env.example` to `.env`, fill the Supabase/Postgres values, then run:

```powershell
pnpm install
pnpm infra:up
pnpm db:generate
pnpm db:migrate
pnpm dev
```

`AUTH_MODE=mock` is allowed only for local development. Production startup
rejects mock auth and missing encryption keys.

The development stack starts PostgreSQL 16 with pgvector, Redis, local
multilingual E5 embeddings and the faster-whisper compatible API. Qdrant and
Elasticsearch are intentionally not used: full-text and vector search live in
PostgreSQL for the first product stage.

## Windows desktop prerequisites

The web client can be developed with Node.js alone. Building the native Tauri
binary also requires:

- Rust stable with the `x86_64-pc-windows-msvc` target;
- Visual Studio 2022 Build Tools with **Desktop development with C++**;
- Microsoft Edge WebView2 Runtime.

### Run the native app in development

The native version uses two terminals.

Terminal 1 — build shared packages, then start the API and realtime server:

```powershell
pnpm build:packages
pnpm --parallel --filter @fixnote/api --filter @fixnote/realtime dev
```

Terminal 2 — start the native Tauri app with hot reload:

```powershell
pnpm desktop:tauri dev
```

`pnpm dev` starts the browser development stack, but does not open the native
Tauri window.

The project MCP configuration is stored in `.codex/config.toml`. Restart Codex
after changing it, then authenticate the Supabase server from the MCP settings.
