# BUILD REPORT — asinlens

Rebuild of `com.easyparser/easyparser` (remote MCP server,
keyless capture) as `@reneturcios/asinlens` 0.1.0 /
`io.github.CloudCorpRecords/asinlens`.

## Fixture conflicts

**None.** The brief, the spec prose, and the fixture agree on all 17
tool names and every required field:

- `get_product_detail` []; `get_product_offers` [`asin`];
  `search_products` []; `lookup_product` [`identifier`,
  `identifier_type`]; `get_sales_history` [`asin`];
  `get_bestseller_rank` [`asin`]; `get_package_dimensions` [`asin`];
  `get_seller_profile` []; `get_seller_products` [];
  `get_seller_feedback` [`seller_id`]; `list_operations` [];
  `list_bulk_jobs` []; `get_bulk_job_items` [`group_id`];
  `get_bulk_item_result` [`item_id`]; `get_bulk_webhook_logs` [];
  `get_error_logs` []; `check_credits` [].

The fixture's tool literals (name, description, inputSchema —
including enums, patterns, minimum/maximum bounds and defaults)
are served verbatim from `src/forward.ts`. The fixture's tool
objects carry **no `title` key** and none was invented (a test
asserts its absence on all 17). Captured annotations, outputSchema
and execution blocks are not reproduced, per the spec (parity
compares inputSchema).

## What was built

All 19 factory files under `builds/asinlens/`:

- `package.json` (`@reneturcios/asinlens` 0.1.0, bin
  `asinlens` → `dist/cli.js`, deps exactly `@modelcontextprotocol/sdk ^1`
  + `zod ^3`; devDeps `@types/node ^20`, `tsx ^4`, `typescript ^5`)
- `server.json` (description exactly the prescribed 93-char string;
  npm entry carries `"version": "0.1.0"`; OCI entry
  `ghcr.io/cloudcorprecords/asinlens:0.1.0` carries **no** version field)
- `Dockerfile` (node:20-alpine both stages; server-name label matches
  `server.json`)
- `tsconfig.json` (fleet-identical, 318 bytes), `.gitignore`,
  `package-lock.json`, `README.md` (fresh prose), `LICENSE` (MIT,
  Copyright (c) 2026 Rene Turcios), `CHANGELOG.md` (single 0.1.0 entry,
  2026-10-27)
- `src/index.ts`, `src/cli.ts`, `src/mcp.ts`, `src/types.ts`,
  `src/forward.ts` (core; exports `VERSION = "0.1.0"`)
- `test/forward.test.ts`
- `.github/workflows/{ci.yml, publish.yml, publish-container.yml,
  registry-publish.yml}` (container workflow: IMAGE
  `ghcr.io/cloudcorprecords/asinlens`, smoke assertion on server name
  `asinlens`)

## Design

- Forwarding client to `https://mcp.easyparser.com/mcp` (pinned),
  overridable via `EASYPARSER_MCP_URL` (labelled reconstruction).
  tools/call is forwarded as a streamable-HTTP JSON-RPC client:
  initialize (protocolVersion `2025-03-26`, clientInfo `asinlens`) →
  notifications/initialized → tools/call, honouring `Mcp-Session-Id`
  when issued; session established lazily and reused per client.
  Plain-JSON and SSE replies both parsed; the matching-id message
  wins; upstream results pass through verbatim (including `isError`
  and extra fields such as `structuredContent`).
- When `EASYPARSER_API_KEY` is set, `Authorization: Bearer <key>` is
  sent on every upstream request (labelled reconstruction; the
  capture was keyless, the registry record declares the header);
  when unset, no auth header is sent. Both branches are covered by
  tests.
- Upstream failures (JSON-RPC error, non-2xx status, malformed body,
  throwing/timing-out fetch) surface as `asinlens error:` text
  results (labelled reconstruction).
- Every captured tool is a data read (`check_credits` is a balance
  read, not a charge); no write capability was added.
- Registration via the MCP SDK **low-level** `Server` API
  (`ListToolsRequestSchema` / `CallToolRequestSchema` handlers)
  serving the fixture literals exactly; no `McpServer` + zod
  registration. `src/mcp.ts` also exports `createServer` /
  `startMcpServer` / `handleCallTool` so the MCP layer is testable
  without a transport; the CLI's `mcp` subcommand starts it over
  stdio.
- Core takes an injectable fetch (`ForwardDeps.fetchFn`), so all
  tests run against a stubbed JSON-RPC upstream. No live network
  calls in tests; no live call claimed anywhere.
- Build note: `TOOL_DEFS` was generated programmatically from the
  fixture JSON. A first generation pass corrupted string escapes
  when the JSON was passed through a regex substitution (escapes in
  the replacement text were reinterpreted); `tsc` caught it, the
  block was regenerated with a literal replacement, and the final
  tree passes the deep-equal registration test and parity below.

## Lockfile (Route 3, clean from birth)

Generated in a temp dir containing only the new `package.json`:
`npm install --package-lock-only --ignore-scripts --offline`.
Verified: parses, `name == @reneturcios/asinlens`, **128 package
entries**; copied into the build dir with matching sha256
(`99a555d2…c2255` on both sides). Then
`npm install --offline --ignore-scripts` in the build dir for
`node_modules`. No write-guard failure occurred; the /tmp staging
was the Route 3 generation step itself, not a fallback.

## Verification (all in the build dir)

- `npx tsc --noEmit` → exit 0
- `npm run build` → real `dist/` (cli.js 2332 B, forward.js 61413 B,
  mcp.js 2668 B, all non-empty, with `.d.ts` + source maps)
- `node dist/cli.js --version` → `0.1.0`; unknown subcommand → usage
  on stderr, exit 2
- `npm test` → **35 tests, 35 pass, 0 fail** (8 suites: registration
  integrity — served tools deep-equal the fixture's full 17 tool
  objects, names in order, required fields per tool, no title key;
  session establishment/reuse/session-id handling; env URL override
  + Bearer header when the key is set / absent when unset; verbatim
  argument forwarding; verbatim result pass-through incl. upstream
  isError and SSE; JSON-RPC/init/malformed/HTTP/throw/timeout
  failures → `asinlens error:`; parseRpcBody; MCP-layer validation;
  CLI --version / unknown exit 2 / bad-JSON exit 2)
- Parity: `python3 harness/parity.py --original
  harness/fixtures/easyparser-tools-original.json --rebuild
  "stdio:node builds/asinlens/dist/cli.js mcp" --out
  builds/asinlens/parity-out` → **PASS, parity 100.0, 17/17
  identical, no missing/extra/schema diffs** (see
  `parity-out/parity.json`)
- Consistency sweep: package.json version = server.json top-level =
  npm-entry version = OCI tag = core `VERSION` = CHANGELOG heading
  (0.1.0); package.json `mcpName` = server.json `name` = Dockerfile
  label; server.json description measured at 93 chars; OCI entry
  confirmed to have no `version` field.

Clean-room: all prose and code written fresh; only the fixture's
tool literals are served verbatim.
