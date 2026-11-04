# asinlens

asinlens is a small local bridge to Easyparser's hosted
MCP server, which turns Amazon pages into structured
data: product details and offers, keyword search,
barcode-to-ASIN lookup, sales history, Best Sellers
Rank, package dimensions, and seller profiles,
feedback and catalogues — plus the account's bulk-job,
webhook-log, error-log and credit-balance views.

The bridge keeps no Amazon data and scrapes nothing
itself. It serves the upstream server's tool list
locally, exactly as captured from the live endpoint,
and forwards each tool call upstream, returning the
result untouched. Every captured tool is a data read:
this rebuild adds no write capability.

## Tools

Product data:

- `get_product_detail` — the full product profile:
  title, brand, images, bullets, Buy Box price and
  availability, Prime eligibility, rating, rank,
  variants, specifications and top reviews. Give
  either `asin` or `url`, never both; optional
  `domain`, `language`, `currency`, `a_plus_content`
  and `seller_id`. No required arguments.
- `get_product_offers` — every seller offer for one
  product, with price, shipping, condition, fulfilment
  type and the Buy Box winner. Required: `asin`.
  Optional filters include `prime`, `free_shipping`,
  `condition` and a page range.
- `search_products` — keyword or search-URL search
  with structured listings and refinement filters.
  Optional `sort_by`, `exclude_sponsored`,
  `refinements` and a page range. No required
  arguments.
- `lookup_product` — convert a UPC, EAN, GTIN, ISBN,
  JAN or MINSAN code (or an ASIN) into the matching
  Amazon ASIN with a product snapshot. Required:
  `identifier` and `identifier_type`.
- `get_sales_history` — up to 12 months of weekly
  trends for traffic, sales, price and rank.
  Required: `asin`; `history_range` picks the depth.
- `get_bestseller_rank` — the current Best Sellers
  Rank in main and sub-categories. Required: `asin`.
- `get_package_dimensions` — exact package size and
  weight plus the Amazon fee category, for FBA fee and
  shipping estimates. Required: `asin`.

Seller data:

- `get_seller_profile` — a merchant's legal business
  name, registered address and feedback trends. Give
  either `seller_id` or `url`. No required arguments.
- `get_seller_products` — a seller's full catalogue
  with prices, Prime status and ratings. Give either
  `seller_id` or `url`. No required arguments.
- `get_seller_feedback` — individual buyer feedback
  entries, filterable by rating and period. Required:
  `seller_id`.

Account and bulk monitoring:

- `list_operations` — the upstream operation catalog
  with parameters, credit costs and examples.
- `list_bulk_jobs` — bulk extraction jobs and their
  progress, filterable by status, operation and
  domain.
- `get_bulk_job_items` — the items inside one bulk
  job. Required: `group_id`.
- `get_bulk_item_result` — the parsed result data of
  one bulk item (retained 24 hours after completion).
  Required: `item_id`.
- `get_bulk_webhook_logs` — webhook delivery logs for
  bulk jobs, optionally scoped to one `group_id`.
- `get_error_logs` — the account's API error logs for
  real-time and bulk channels.
- `check_credits` — plan, credit balance, reset date,
  rate limits and this month's usage by operation. No
  arguments.

## Configuration

- `EASYPARSER_MCP_URL` (optional) — override the
  upstream endpoint. Defaults to
  `https://mcp.easyparser.com/mcp`. (The override hook
  is this rebuild's own labelled reconstruction.)
- `EASYPARSER_API_KEY` (optional) — when set, every
  upstream request carries an
  `Authorization: Bearer <key>` header. When it is not
  set, no auth header is sent. (This forwarding is
  also a labelled reconstruction; the original surface
  was captured keyless, though the registry record
  declares the Authorization header.)

### Forwarding mechanics

On the first tool call the client opens a streamable
HTTP session with the upstream: a JSON-RPC
`initialize` request (protocolVersion `2025-03-26`,
clientInfo name `asinlens`), then a
`notifications/initialized` notification, then the
`tools/call` request carrying the caller's arguments
unchanged. When the upstream answers `initialize`
with an `Mcp-Session-Id` header, that value rides on
every later request of the session, which is reused
for the life of the process. Replies may arrive as
plain JSON or as server-sent events; both are read.

Successful upstream results pass through verbatim,
including any `isError` flag the upstream sets.
Failures — a JSON-RPC error, a non-2xx status, an
unreadable response, or a request that cannot be
completed — come back as an `isError` result whose
text starts with `asinlens error:` (this rendering is
this rebuild's own labelled reconstruction).

## CLI

Each tool is also a subcommand taking one JSON
argument string (omit it for tools that take none):

```bash
npx @reneturcios/asinlens get_product_offers '{"asin":"B0CJB6V2L5"}'
npx @reneturcios/asinlens lookup_product '{"identifier":"724382975021","identifier_type":"UPC"}'
npx @reneturcios/asinlens check_credits
npx @reneturcios/asinlens --version
```

Exit codes: `0` on success, `1` on an `isError`
result, `2` on a usage error.

## MCP server

```bash
npx -y @reneturcios/asinlens mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "asinlens": {
      "command": "npx",
      "args": ["-y", "@reneturcios/asinlens", "mcp"]
    }
  }
}
```

## Docker

```bash
docker run -i ghcr.io/cloudcorprecords/asinlens
docker run --rm ghcr.io/cloudcorprecords/asinlens --version
```

The container's default command is `mcp`, so the first
form is a stdio MCP server; any other arguments reach
the CLI normally.

## Development

```bash
npm install
npm run build
npm test
npm run dev
```

The test suite runs entirely against a stubbed
JSON-RPC upstream — no live network calls.

## License

MIT — see `LICENSE`.
