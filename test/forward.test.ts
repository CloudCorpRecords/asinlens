import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import {
  AsinlensClient,
  callTool,
  createClient,
  DEFAULT_ENDPOINT_URL,
  parseRpcBody,
  PROTOCOL_VERSION,
  TOOL_DEFS,
  TOOL_NAMES,
  VERSION,
} from "../src/forward.js";
import { handleCallTool } from "../src/mcp.js";
import type {
  FetchFn,
  FetchResponseLike,
  ToolDef,
  ToolResult,
} from "../src/types.js";

/**
 * Every test runs against a stubbed JSON-RPC upstream
 * implementing the streamable-HTTP session flow
 * (initialize -> notifications/initialized -> tools/call):
 * no live network, no live call — the real
 * mcp.easyparser.com endpoint is never contacted.
 */

const FIXTURE_URL = new URL(
  "../../../harness/fixtures/easyparser-tools-original.json",
  import.meta.url,
);
const FIXTURE_AVAILABLE = existsSync(FIXTURE_URL);
const fixture = (
  FIXTURE_AVAILABLE
    ? JSON.parse(readFileSync(FIXTURE_URL, "utf-8"))
    : { tools: [] }
) as {
  tools: ToolDef[];
};

/**
 * Publish-survival guard (Wave 25 preflight, proven Wave 24 pattern):
 * the parity fixture lives in the build harness, outside the published
 * repo tree, so fixture-dependent tests skip cleanly when it is absent;
 * with the fixture present they run in full, with no skips.
 */
function skipWithoutFixture(t: {
  skip: (message: string) => void;
}): boolean {
  if (FIXTURE_AVAILABLE) return false;
  t.skip("parity fixture lives in the build harness, not the repo tree");
  return true;
}

const SAMPLE_RESULT = {
  content: [{ type: "text", text: "{\"title\":\"Widget\",\"asin\":\"B0CJB6V2L5\"}" }],
  structuredContent: { asin: "B0CJB6V2L5" },
};

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

interface FakeOptions {
  callResult?: Record<string, unknown>;
  callBodyText?: string;
  callError?: Record<string, unknown>;
  callStatus?: number;
  initError?: Record<string, unknown>;
  throwOn?: "initialize" | "tools/call";
  sessionId?: string | null;
  hangOnCall?: boolean;
  sse?: boolean;
}

function makeResponse(
  status: number,
  bodyText: string,
  headers: Record<string, string> = {},
): FetchResponseLike {
  const lowered = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => lowered.get(name.toLowerCase()) ?? null },
    text: async () => bodyText,
  };
}

function jsonResponse(
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
) {
  return makeResponse(status, JSON.stringify(payload), headers);
}

function makeUpstream(options: FakeOptions = {}): {
  fetchFn: FetchFn;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
    calls.push({ url, headers: init?.headers ?? {}, body });
    const method = body.method as string;
    if (options.throwOn === method) throw new Error("socket hang up");
    if (method === "initialize") {
      if (options.initError !== undefined) {
        return jsonResponse(200, {
          jsonrpc: "2.0",
          id: body.id,
          error: options.initError,
        });
      }
      const headers: Record<string, string> = {};
      const sessionId =
        options.sessionId === undefined ? "sess-xyz" : options.sessionId;
      if (sessionId !== null) headers["mcp-session-id"] = sessionId;
      return jsonResponse(
        200,
        {
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            serverInfo: { name: "easyparser", version: "1.3.1" },
          },
        },
        headers,
      );
    }
    if (method === "notifications/initialized") {
      return makeResponse(202, "");
    }
    if (method === "tools/call") {
      if (options.hangOnCall) {
        return new Promise<FetchResponseLike>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            if (signal.aborted) {
              reject(new Error("aborted"));
              return;
            }
            signal.addEventListener("abort", () => reject(new Error("aborted")));
          }
        });
      }
      if (options.callBodyText !== undefined) {
        return makeResponse(options.callStatus ?? 200, options.callBodyText);
      }
      if (options.callError !== undefined) {
        return jsonResponse(200, {
          jsonrpc: "2.0",
          id: body.id,
          error: options.callError,
        });
      }
      const result = options.callResult ?? SAMPLE_RESULT;
      const payload = { jsonrpc: "2.0", id: body.id, result };
      if (options.sse) {
        return makeResponse(
          200,
          `event: message\ndata: ${JSON.stringify(payload)}\n\n`,
        );
      }
      return jsonResponse(options.callStatus ?? 200, payload);
    }
    return jsonResponse(200, {});
  };
  return { fetchFn, calls };
}

function stubClient(options: FakeOptions = {}, extra: Record<string, unknown> = {}) {
  const upstream = makeUpstream(options);
  const c = new AsinlensClient({
    fetchFn: upstream.fetchFn,
    env: {},
    ...extra,
  });
  return { client: c, calls: upstream.calls };
}

function textOf(result: ToolResult): string {
  const content = result.content as Array<{ type: string; text: string }>;
  return content[0].text;
}

function methods(calls: Captured[]): string[] {
  return calls.map((c) => c.body.method as string);
}

/* ------------------------------------------------------------------ */

describe("registration integrity (captured surface)", () => {
  it("serves exactly the fixture's 17 tools, deep-equal", (t) => {
    if (skipWithoutFixture(t)) return;
    assert.equal(fixture.tools.length, 17);
    assert.deepEqual(TOOL_DEFS, fixture.tools);
  });

  it("serves the 17 tool names in fixture order", () => {
    assert.deepEqual(TOOL_NAMES, [
      "get_product_detail",
      "get_product_offers",
      "search_products",
      "lookup_product",
      "get_sales_history",
      "get_bestseller_rank",
      "get_package_dimensions",
      "get_seller_profile",
      "get_seller_products",
      "get_seller_feedback",
      "list_operations",
      "list_bulk_jobs",
      "get_bulk_job_items",
      "get_bulk_item_result",
      "get_bulk_webhook_logs",
      "get_error_logs",
      "check_credits",
    ]);
  });

  it("carries exactly the fixture's required fields per tool", () => {
    const required = new Map(
      TOOL_DEFS.map((t) => [
        t.name,
        (t.inputSchema as { required?: string[] }).required ?? [],
      ]),
    );
    assert.deepEqual(required.get("get_product_detail"), []);
    assert.deepEqual(required.get("get_product_offers"), ["asin"]);
    assert.deepEqual(required.get("search_products"), []);
    assert.deepEqual(required.get("lookup_product"), ["identifier", "identifier_type"]);
    assert.deepEqual(required.get("get_sales_history"), ["asin"]);
    assert.deepEqual(required.get("get_bestseller_rank"), ["asin"]);
    assert.deepEqual(required.get("get_package_dimensions"), ["asin"]);
    assert.deepEqual(required.get("get_seller_profile"), []);
    assert.deepEqual(required.get("get_seller_products"), []);
    assert.deepEqual(required.get("get_seller_feedback"), ["seller_id"]);
    assert.deepEqual(required.get("list_operations"), []);
    assert.deepEqual(required.get("list_bulk_jobs"), []);
    assert.deepEqual(required.get("get_bulk_job_items"), ["group_id"]);
    assert.deepEqual(required.get("get_bulk_item_result"), ["item_id"]);
    assert.deepEqual(required.get("get_bulk_webhook_logs"), []);
    assert.deepEqual(required.get("get_error_logs"), []);
    assert.deepEqual(required.get("check_credits"), []);
  });

  it("serves no title key on any tool (the capture carries none)", () => {
    for (const t of TOOL_DEFS) {
      assert.equal("title" in t, false, t.name);
    }
  });
});

/* ------------------------------------------------------------------ */

describe("session establishment and reuse", () => {
  it("runs initialize, notifications/initialized, then tools/call in order", async () => {
    const { client: c, calls } = stubClient();
    const out = await c.callTool("check_credits", {});
    assert.equal(out.isError, undefined);
    assert.deepEqual(methods(calls), [
      "initialize",
      "notifications/initialized",
      "tools/call",
    ]);
    assert.ok(calls.every((call) => call.url === DEFAULT_ENDPOINT_URL));
    assert.equal(DEFAULT_ENDPOINT_URL, "https://mcp.easyparser.com/mcp");

    const initParams = calls[0].body.params as Record<string, unknown>;
    assert.equal(initParams.protocolVersion, PROTOCOL_VERSION);
    assert.deepEqual(initParams.capabilities, {});
    assert.deepEqual(initParams.clientInfo, {
      name: "asinlens",
      version: VERSION,
    });
    assert.equal(calls[0].headers["Mcp-Session-Id"], undefined);
    for (const call of calls) {
      assert.equal(call.headers["Content-Type"], "application/json");
      assert.equal(
        call.headers["Accept"],
        "application/json, text/event-stream",
      );
    }
    assert.equal(calls[1].headers["Mcp-Session-Id"], "sess-xyz");
    assert.equal(calls[2].headers["Mcp-Session-Id"], "sess-xyz");
  });

  it("establishes the session lazily once and reuses it on later calls", async () => {
    const { client: c, calls } = stubClient();
    await c.callTool("check_credits", {});
    await c.callTool("list_operations", {});
    assert.deepEqual(methods(calls), [
      "initialize",
      "notifications/initialized",
      "tools/call",
      "tools/call",
    ]);
    assert.equal(calls[3].headers["Mcp-Session-Id"], "sess-xyz");
    assert.notEqual(calls[2].body.id, calls[3].body.id);
  });

  it("sends no session header when the upstream issues none", async () => {
    const { client: c, calls } = stubClient({ sessionId: null });
    const out = await c.callTool("check_credits", {});
    assert.equal(out.isError, undefined);
    assert.ok(calls.every((call) => call.headers["Mcp-Session-Id"] === undefined));
  });

  it("honours the EASYPARSER_MCP_URL env override", async () => {
    const upstream = makeUpstream();
    const c = new AsinlensClient({
      fetchFn: upstream.fetchFn,
      env: { EASYPARSER_MCP_URL: "https://staging.example.com/mcp" },
    });
    await c.callTool("check_credits", {});
    assert.ok(
      upstream.calls.every((call) => call.url === "https://staging.example.com/mcp"),
    );
  });

  it("honours an explicit url override over the default endpoint", async () => {
    const upstream = makeUpstream();
    const c = createClient({
      fetchFn: upstream.fetchFn,
      env: {},
      url: "https://alt.example.com/mcp",
    });
    await c.callTool("check_credits", {});
    assert.ok(
      upstream.calls.every((call) => call.url === "https://alt.example.com/mcp"),
    );
  });
});

/* ------------------------------------------------------------------ */

describe("upstream auth header", () => {
  it("sends Authorization: Bearer <key> on every request when EASYPARSER_API_KEY is set", async () => {
    const upstream = makeUpstream();
    const c = new AsinlensClient({
      fetchFn: upstream.fetchFn,
      env: { EASYPARSER_API_KEY: "test-key-123" },
    });
    await c.callTool("check_credits", {});
    assert.equal(upstream.calls.length, 3);
    assert.ok(
      upstream.calls.every(
        (call) => call.headers["Authorization"] === "Bearer test-key-123",
      ),
    );
  });

  it("sends no Authorization header when EASYPARSER_API_KEY is unset", async () => {
    const { client: c, calls } = stubClient();
    await c.callTool("check_credits", {});
    assert.ok(calls.every((call) => call.headers["Authorization"] === undefined));
  });
});

/* ------------------------------------------------------------------ */

describe("tools/call forwarding", () => {
  it("forwards get_product_offers arguments verbatim", async () => {
    const { client: c, calls } = stubClient();
    const args = {
      asin: "B0CJB6V2L5",
      domain: ".de",
      prime: true,
      condition: "new",
      max_page: 2,
    };
    await c.callTool("get_product_offers", args);
    const params = calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, "get_product_offers");
    assert.deepEqual(params.arguments, args);
  });

  it("forwards lookup_product with both required fields", async () => {
    const { client: c, calls } = stubClient();
    await c.callTool("lookup_product", {
      identifier: "724382975021",
      identifier_type: "UPC",
    });
    const params = calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, "lookup_product");
    assert.deepEqual(params.arguments, {
      identifier: "724382975021",
      identifier_type: "UPC",
    });
  });

  it("forwards a no-argument tool with an empty arguments object", async () => {
    const { client: c, calls } = stubClient();
    await c.callTool("check_credits", {});
    const params = calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, "check_credits");
    assert.deepEqual(params.arguments, {});
  });

  it("passes the upstream result through verbatim, including extra fields", async () => {
    const { client: c } = stubClient();
    const out = await c.callTool("get_product_detail", { asin: "B0CJB6V2L5" });
    assert.deepEqual(out, SAMPLE_RESULT);
  });

  it("passes an upstream isError result through untouched", async () => {
    const upstreamResult = {
      content: [{ type: "text", text: "product not found" }],
      isError: true,
    };
    const { client: c } = stubClient({ callResult: upstreamResult });
    const out = await c.callTool("get_bestseller_rank", { asin: "B0CJB6V2L5" });
    assert.deepEqual(out, upstreamResult);
  });

  it("reads an SSE-framed tools/call response", async () => {
    const { client: c } = stubClient({ sse: true });
    const out = await c.callTool("check_credits", {});
    assert.equal(out.isError, undefined);
    assert.deepEqual(out, SAMPLE_RESULT);
  });

  it("the one-shot callTool helper forwards under the right tool name", async () => {
    const upstream = makeUpstream();
    const out = await callTool(
      "get_seller_feedback",
      { seller_id: "A1MCYUGJD2ILFU", max_rating: 3 },
      { fetchFn: upstream.fetchFn, env: {} },
    );
    assert.equal(out.isError, undefined);
    const params = upstream.calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, "get_seller_feedback");
    assert.deepEqual(params.arguments, {
      seller_id: "A1MCYUGJD2ILFU",
      max_rating: 3,
    });
  });
});

/* ------------------------------------------------------------------ */

describe("upstream failures surface as asinlens error text", () => {
  it("maps a JSON-RPC error to `asinlens error: <message>`", async () => {
    const { client: c } = stubClient({
      callError: { code: -32000, message: "insufficient credits" },
    });
    const out = await c.callTool("get_product_detail", { asin: "B0CJB6V2L5" });
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "asinlens error: insufficient credits");
  });

  it("maps an initialize JSON-RPC error to asinlens error text", async () => {
    const { client: c } = stubClient({
      initError: { code: -32600, message: "bad initialize" },
    });
    const out = await c.callTool("check_credits", {});
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "asinlens error: bad initialize");
  });

  it("maps an unparseable upstream response to a malformed-response error", async () => {
    const { client: c } = stubClient({ callBodyText: "<html>oops</html>" });
    const out = await c.callTool("search_products", { keyword: "widget" });
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "asinlens error: malformed response");
  });

  it("maps a non-2xx upstream status to asinlens error text", async () => {
    const { client: c } = stubClient({
      callBodyText: "internal error",
      callStatus: 500,
    });
    const out = await c.callTool("search_products", { keyword: "widget" });
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "asinlens error: HTTP 500");
  });

  it("maps a throwing fetch to asinlens error text", async () => {
    const { client: c } = stubClient({ throwOn: "tools/call" });
    const out = await c.callTool("check_credits", {});
    assert.equal(out.isError, true);
    assert.match(textOf(out), /^asinlens error: /);
  });

  it("maps a throwing initialize fetch to asinlens error text", async () => {
    const { client: c } = stubClient({ throwOn: "initialize" });
    const out = await c.callTool("check_credits", {});
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "asinlens error: socket hang up");
  });

  it("maps a timed-out call to asinlens error text", async () => {
    const { client: c } = stubClient({ hangOnCall: true }, { timeoutMs: 20 });
    const out = await c.callTool("check_credits", {});
    assert.equal(out.isError, true);
    assert.match(textOf(out), /^asinlens error: /);
  });
});

/* ------------------------------------------------------------------ */

describe("parseRpcBody", () => {
  it("parses plain JSON and picks the message with the matching id", () => {
    const body = '{"jsonrpc":"2.0","id":7,"result":{"ok":true}}';
    assert.deepEqual(parseRpcBody(body, 7), {
      jsonrpc: "2.0",
      id: 7,
      result: { ok: true },
    });
  });

  it("parses SSE data lines", () => {
    const body =
      'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"ok":true}}\n\n';
    assert.deepEqual(parseRpcBody(body, 2), {
      jsonrpc: "2.0",
      id: 2,
      result: { ok: true },
    });
  });

  it("returns null for empty and unparseable bodies", () => {
    assert.equal(parseRpcBody(""), null);
    assert.equal(parseRpcBody("not json at all"), null);
  });
});

/* ------------------------------------------------------------------ */

describe("MCP layer validation", () => {
  it("rejects an unknown tool before any network hop", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await assert.rejects(
      () => handleCallTool(c, "not_a_tool", {}),
      (err: unknown) => err instanceof McpError,
    );
    assert.equal(upstream.calls.length, 0);
  });

  it("rejects non-object arguments before any network hop", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await assert.rejects(
      () => handleCallTool(c, "search_products", ["nope"]),
      (err: unknown) => err instanceof McpError,
    );
    assert.equal(upstream.calls.length, 0);
  });

  it("forwards a valid call through the MCP layer unchanged", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    const out = await handleCallTool(c, "get_bulk_job_items", { group_id: "grp-1" });
    assert.deepEqual(out, SAMPLE_RESULT);
    const params = upstream.calls[2].body.params as Record<string, unknown>;
    assert.deepEqual(params.arguments, { group_id: "grp-1" });
  });
});

/* ------------------------------------------------------------------ */

describe("CLI", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

  function runCli(args: string[]) {
    return spawnSync(process.execPath, ["--import", "tsx", cliPath, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
    });
  }

  it("--version prints 0.1.0 and exits 0", () => {
    const res = runCli(["--version"]);
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), "0.1.0");
  });

  it("an unknown command prints usage on stderr and exits 2", () => {
    const res = runCli(["not-a-tool"]);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /Usage:/);
  });

  it("a non-JSON argument exits 2", () => {
    const res = runCli(["search_products", "not json"]);
    assert.equal(res.status, 2);
  });

  it("a JSON array argument exits 2", () => {
    const res = runCli(["search_products", "[]"]);
    assert.equal(res.status, 2);
  });
});
