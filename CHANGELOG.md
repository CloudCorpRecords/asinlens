# Changelog

## 0.1.0 (2026-10-27)

- First release: a forwarding client for the hosted Easyparser MCP server, serving all 17 captured tools locally for tools/list and forwarding every tools/call upstream over a streamable-HTTP JSON-RPC session (initialize, notifications/initialized, tools/call, honouring the Mcp-Session-Id header when issued).
- Tools: `get_product_detail`, `get_product_offers`, `search_products`, `lookup_product`, `get_sales_history`, `get_bestseller_rank`, `get_package_dimensions`, `get_seller_profile`, `get_seller_products`, `get_seller_feedback`, `list_operations`, `list_bulk_jobs`, `get_bulk_job_items`, `get_bulk_item_result`, `get_bulk_webhook_logs`, `get_error_logs`, `check_credits`. Every captured tool is a data read; no write capability is added.
- Upstream results pass through verbatim; upstream failures surface as `asinlens error:` text results.
- One bin serves the CLI (one subcommand per tool, plus `--version`) and the stdio MCP server (`mcp` subcommand). Upstream endpoint overridable via `EASYPARSER_MCP_URL`; when `EASYPARSER_API_KEY` is set it is sent as a Bearer token on every upstream request.
