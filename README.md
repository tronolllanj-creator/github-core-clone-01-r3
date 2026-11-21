[![make.fun · github-core-clone-01](https://make.fun/badge/github-core-clone-01.svg)](https://make.fun/bounty/github-core-clone-01?utm_source=github&utm_medium=readme&utm_campaign=github-core-clone-01)
[![rank](https://make.fun/badge/github-core-clone-01/tronolllanj-creator/github-core-clone-01-r3/rank.svg)](https://make.fun/bounty/github-core-clone-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=github-core-clone-01)
[![reward](https://make.fun/badge/github-core-clone-01/tronolllanj-creator/github-core-clone-01-r3/reward.svg)](https://make.fun/bounty/github-core-clone-01?utm_source=github&utm_medium=readme&utm_campaign=github-core-clone-01)

# make.fun github-core-clone-01

A standalone, in-memory Node 22 TypeScript git forge entry implementing Git Smart HTTP, GitHub REST v3, GraphQL v4, and the Model Context Protocol (MCP).

## Requirements

- Node.js v22+ (uses native experimental TypeScript execution)

## Running the Server

The server runs on a dynamic ephemeral port and registers itself automatically with the test harness using the required environment variables:

```bash
MAKEFUN_SHOP_TOKEN="your-shop-token" \
MAKEFUN_ENV_URL="https://env.make.fun" \
MAKEFUN_TRIAL_NOW="2025-01-01T00:00:00.000Z" \
MAKEFUN_TRIAL_SEED="42" \
node --experimental-strip-types main.ts
```

### Trial Lifecycle Flow
1. Binds an ephemeral local port.
2. Performs a `POST` request with the assigned port to `$MAKEFUN_ENV_URL/register` using `$MAKEFUN_SHOP_TOKEN`.
3. Long-polls `$MAKEFUN_ENV_URL/done` until the evaluation finishes.

## Implemented Features

- **Git Smart HTTP**: Native implementation of `upload-pack` (v2) and `receive-pack` (v0) routed at `/{owner}/{repo}.git`.
- **GitHub REST API (v3)**: Core endpoints for repositories, issues, pulls, commits, users, and contents under `/api/v3`.
- **GraphQL API (v4)**: Query and mutation support under `/api/graphql` tailored for agentic workflows.
- **Model Context Protocol (MCP)**: Tool and resource provider exposing forge actions directly to LLMs under `/mcp`.
- **In-Memory & Deterministic**: Zero external databases. Pre-seeded with a fixed scenario (`adaiversen` with 30 repositories). Fully deterministic behavior governed by `MAKEFUN_TRIAL_NOW` and seed data.

## Local Verification

To run the local conformance and performance test suite provided by the kit:

```bash
node --experimental-strip-types sdk/run.ts --url http://127.0.0.1:PORT --token TOK --perf
```

*(Passes 120/120 local conformance tests and scores 978/1000 total with performance metrics).*

## Round-3 Fixes (perf strike)

- **Fast pack inflation**: `inflateAt` in gitobj.ts now inflates the remainder once and locates the exact compressed length via an Adler-32 trailer scan, instead of binary-searching the length with throwing `inflateSync` probes.
- **Fast routing**: app.ts parses the URL manually and dispatches REST routes before the git regexes, with lazy query parsing.

## Round-2 Fixes

- **Correct `/done` polling**: Fixed the long-polling logic so the server properly waits for and receives the evaluation completion signal, allowing the test harness to grade the entry.
- **Comments-list fix**: Resolved an issue in the comments list endpoint that affected conformance scoring.

## Source Code Layout

- `main.ts` — Entry point, HTTP server bootstrap, and trial registration lifecycle.
- `app.ts` — Core request router handling Git HTTP, REST, GraphQL, and MCP multiplexing.
- `store.ts` — In-memory state manager, fixed scenario seeding (`adaiversen`), and deterministic ID generation.
- `gitobj.ts` — Git object database primitives (loose objects, packfile parsing/generation, trees, commits, blobs).
- `gitproto.ts` — Git Smart HTTP protocol handshake and `upload-pack` v2 wire protocol implementation.
- `gitrecv.ts` — Git `receive-pack` v0 packfile ingestion, ref updates, and state mutation.
- `rest.ts` — GitHub REST v3 route handlers.
- `graphql.ts` — GraphQL v4 schema execution engine and resolvers.
- `mcp.ts` — Model Context Protocol transport handlers and tool definitions.
