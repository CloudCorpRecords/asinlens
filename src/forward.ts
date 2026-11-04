/**
 * asinlens core: a forwarding client for the hosted
 * Easyparser MCP server.
 *
 * Nothing is computed locally. tools/list is answered
 * from the literal tool definitions below, taken verbatim
 * from a live capture of the upstream server (name,
 * description and inputSchema exactly as captured; the
 * capture carries no title key and its annotations are
 * not reproduced). A tools/call
 * is forwarded over a streamable-HTTP JSON-RPC session:
 * an initialize POST, a notifications/initialized POST,
 * then the tools/call POST, honouring the Mcp-Session-Id
 * response header when the upstream issues one. The
 * session is established lazily on the first forwarded
 * call and reused for the lifetime of the client. Every
 * captured tool is a data read, and this client adds no
 * write capability of its own.
 *
 * The upstream endpoint is pinned to
 * https://mcp.easyparser.com/mcp and can be overridden with
 * the EASYPARSER_MCP_URL environment variable (that override
 * is a labelled reconstruction). When EASYPARSER_API_KEY is
 * set in the environment, every upstream request carries
 * `Authorization: Bearer <key>` (also a labelled
 * reconstruction — the capture was taken keyless);
 * otherwise no auth header is sent.
 *
 * Upstream results pass through verbatim, including any
 * isError flag and any extra result fields. Failures — a
 * JSON-RPC error from the upstream, a non-2xx status, an
 * unparseable response, or a fetch that throws or times
 * out — surface as an isError result whose text starts
 * with `asinlens error:` (that rendering is a labelled
 * reconstruction). Responses may be plain JSON or SSE
 * (data: lines); the JSON-RPC message with the matching
 * id wins.
 */
import type {
  FetchFn,
  FetchResponseLike,
  ForwardDeps,
  ToolArgs,
  ToolDef,
  ToolResult,
} from "./types.js";

export const VERSION = "0.1.0";

export const DEFAULT_ENDPOINT_URL = "https://mcp.easyparser.com/mcp";

export const DEFAULT_TIMEOUT_MS = 30000;

export const PROTOCOL_VERSION = "2025-03-26";

/* ------------------------------------------------------------------ */
/* Tool definitions (tools/list literals, verbatim from the live       */
/* capture in harness/fixtures/easyparser-tools-original.json)            */
/* ------------------------------------------------------------------ */

export const TOOL_DEFS: ToolDef[] = [
  {
    "name": "get_product_detail",
    "description": "Fetch complete, structured information about a single Amazon product: title, brand, images, feature bullets, description, Buy Box price and availability, Prime eligibility, rating and review count, Best Sellers Rank, category path, variants, specifications, and top reviews. This is the primary tool for product analysis, listing enrichment, and price monitoring.\n\nUse this tool when you need a full product profile. If you only need competing seller prices, use get_product_offers instead (cheaper context). If you only need the sales rank, use get_bestseller_rank. If you only need shipping dimensions or the FBA fee category, use get_package_dimensions.\n\nProvide EITHER the identifier field OR url — never both. Costs 1 credit; set a_plus_content to true only when the user explicitly asks about enhanced brand content, as it costs 1 extra credit.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "asin": {
          "type": "string",
          "pattern": "^[A-Z0-9]{10}$",
          "description": "Amazon Standard Identification Number — a 10-character alphanumeric product identifier (e.g. B0CJB6V2L5). Found in the product URL after /dp/ or /gp/product/."
        },
        "url": {
          "type": "string",
          "format": "uri",
          "description": "Full Amazon product URL (e.g. https://www.amazon.com/dp/B0CJB6V2L5). Use this when the user pastes a link instead of an ASIN."
        },
        "domain": {
          "type": "string",
          "enum": [
            ".com",
            ".co.uk",
            ".de",
            ".fr",
            ".it",
            ".es",
            ".ca",
            ".com.mx",
            ".com.br",
            ".co.jp",
            ".in",
            ".com.au",
            ".ae",
            ".sa",
            ".nl",
            ".pl",
            ".se",
            ".be",
            ".com.tr",
            ".sg",
            ".ie"
          ],
          "default": ".com",
          "description": "Amazon marketplace domain extension. Determines the regional Amazon site the data is fetched from. Use the domain that matches the user's market — prices, availability and rankings differ across marketplaces."
        },
        "language": {
          "type": "string",
          "description": "Language code for the Amazon page, in locale format (e.g. en_US, de_DE, tr_TR). Affects the language of titles, descriptions and reviews in the response."
        },
        "currency": {
          "type": "string",
          "description": "ISO currency code for price display (e.g. usd, eur, try). Prices are converted by Amazon's own display logic."
        },
        "a_plus_content": {
          "type": "boolean",
          "default": false,
          "description": "Set true to include the 'From the manufacturer' A+ enhanced brand content. Costs 1 additional credit. Default false."
        },
        "seller_id": {
          "type": "string",
          "description": "Fetch the product as offered by a specific seller (their Seller ID). Only use when the user asks about a specific merchant's offer."
        }
      },
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "get_product_offers",
    "description": "Fetch the list of seller offers for an Amazon product: every merchant selling the item with their price, shipping cost, condition (new/used), fulfillment type (FBA/FBM), and seller rating. Also returns the Buy Box winner. This is the tool for competitive price analysis, reseller monitoring, and availability tracking.\n\nUse this tool when the question is about WHO sells the product and at WHAT price. If you need the product's own details (title, images, rating), use get_product_detail instead.\n\nEach requested page costs 1 credit. Start with a single page (default) and only increase max_page if the user needs the full offer list. Use the condition and shipping filters to narrow results instead of paginating — it is cheaper.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "asin": {
          "type": "string",
          "pattern": "^[A-Z0-9]{10}$",
          "description": "Amazon Standard Identification Number — a 10-character alphanumeric product identifier (e.g. B0CJB6V2L5). Found in the product URL after /dp/ or /gp/product/."
        },
        "domain": {
          "type": "string",
          "enum": [
            ".com",
            ".co.uk",
            ".de",
            ".fr",
            ".it",
            ".es",
            ".ca",
            ".com.mx",
            ".com.br",
            ".co.jp",
            ".in",
            ".com.au",
            ".ae",
            ".sa",
            ".nl",
            ".pl",
            ".se",
            ".be",
            ".com.tr",
            ".sg",
            ".ie"
          ],
          "default": ".com",
          "description": "Amazon marketplace domain extension. Determines the regional Amazon site the data is fetched from. Use the domain that matches the user's market — prices, availability and rankings differ across marketplaces."
        },
        "prime": {
          "type": "boolean",
          "description": "If true, return only Prime-eligible offers."
        },
        "free_shipping": {
          "type": "boolean",
          "description": "If true, return only offers with free shipping."
        },
        "condition": {
          "type": "string",
          "enum": [
            "new",
            "used_like_new",
            "used_very_good",
            "used_good",
            "used_acceptable"
          ],
          "description": "Filter offers by item condition. Omit to include all conditions."
        },
        "min_page": {
          "type": "integer",
          "minimum": 1,
          "default": 1,
          "description": "Starting page number. Default 1."
        },
        "max_page": {
          "type": "integer",
          "minimum": 1,
          "maximum": 5,
          "default": 1,
          "description": "Ending page number. Each page costs 1 credit; max 5 pages per request. Default 1."
        }
      },
      "required": [
        "asin"
      ],
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "search_products",
    "description": "Search Amazon by keyword or a full search/category URL and get structured product listings: ASIN, title, price, rating, review count, Prime status, and badges (Best Seller, Amazon's Choice) for each result. Also returns the available refinement filters (category, brand, price range) with their IDs.\n\nUse this tool for market research, keyword analysis, and product discovery. If the user already has an ASIN or product URL, do NOT search — use get_product_detail directly.\n\nEach page costs 1 credit. One page typically returns 20-40 products, which is enough for most questions. Use sort_by and exclude_sponsored to improve result quality instead of fetching more pages. To filter by category or brand, first run one search and read the refinements field in the response to discover valid filter IDs, then pass them in refinements.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "keyword": {
          "type": "string",
          "description": "Search query as a user would type it into Amazon (e.g. 'stainless steel water bottle 40oz'). Mutually exclusive with url."
        },
        "url": {
          "type": "string",
          "format": "uri",
          "description": "Full Amazon search or category URL. Use when the user pastes an Amazon link containing filters. Mutually exclusive with keyword."
        },
        "domain": {
          "type": "string",
          "enum": [
            ".com",
            ".co.uk",
            ".de",
            ".fr",
            ".it",
            ".es",
            ".ca",
            ".com.mx",
            ".com.br",
            ".co.jp",
            ".in",
            ".com.au",
            ".ae",
            ".sa",
            ".nl",
            ".pl",
            ".se",
            ".be",
            ".com.tr",
            ".sg",
            ".ie"
          ],
          "default": ".com",
          "description": "Amazon marketplace domain extension. Determines the regional Amazon site the data is fetched from. Use the domain that matches the user's market — prices, availability and rankings differ across marketplaces."
        },
        "sort_by": {
          "type": "string",
          "enum": [
            "featured",
            "price-asc-rank",
            "price-desc-rank",
            "review-rank",
            "date-desc-rank",
            "exact-aware-popularity-rank"
          ],
          "default": "featured",
          "description": "Result ordering. 'featured' is Amazon's default; 'price-asc-rank' cheapest first; 'price-desc-rank' most expensive; 'review-rank' most reviewed; 'date-desc-rank' newest listings; 'exact-aware-popularity-rank' by popularity."
        },
        "exclude_sponsored": {
          "type": "boolean",
          "default": false,
          "description": "If true, removes sponsored (paid ad) products from results. Recommended true for organic market analysis."
        },
        "refinements": {
          "type": "string",
          "description": "Category/attribute filters in Amazon's format: 'n:<category_id>,p_<filter_group>:<filter_id>'. Discover valid IDs from the refinements field of a previous search response. Example: 'n:7141123011,p_123:502215'."
        },
        "language": {
          "type": "string",
          "description": "Language code for the Amazon page, in locale format (e.g. en_US, de_DE, tr_TR). Affects the language of titles, descriptions and reviews in the response."
        },
        "currency": {
          "type": "string",
          "description": "ISO currency code for price display (e.g. usd, eur, try). Prices are converted by Amazon's own display logic."
        },
        "min_page": {
          "type": "integer",
          "minimum": 1,
          "default": 1,
          "description": "Starting page number. Default 1."
        },
        "max_page": {
          "type": "integer",
          "minimum": 1,
          "maximum": 5,
          "default": 1,
          "description": "Ending page number. Each page costs 1 credit; max 5 pages per request. Default 1."
        }
      },
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "lookup_product",
    "description": "Convert an external product identifier (UPC, EAN, GTIN, ISBN, JAN, MINSAN) into the corresponding Amazon ASIN, with an essential product snapshot. This is the bridge between manufacturer/retail barcodes and the Amazon ecosystem.\n\nUse this tool when the user has a barcode or standard product code and wants to find the matching Amazon listing. Typical workflows: catalog matching, inventory synchronization, converting supplier data into Amazon ASINs. Also accepts ASIN as input type if you need to validate one.\n\nYou MUST set identifier_type to match the code you have — guessing the wrong type returns no results. UPC is 12 digits, EAN/GTIN is 13, ISBN is 10 or 13 (books). If the user gives a keyword instead of a code, use search_products instead. Costs 1 credit.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "identifier": {
          "type": "string",
          "description": "The product code value (e.g. '724382975021' for a UPC). Digits only for barcode types."
        },
        "identifier_type": {
          "type": "string",
          "enum": [
            "ASIN",
            "EAN",
            "GTIN",
            "ISBN",
            "JAN",
            "MINSAN",
            "UPC"
          ],
          "description": "The type of code provided. UPC: 12-digit US barcode. EAN/GTIN: 13-digit international barcode. ISBN: book identifier. JAN: Japanese barcode. MINSAN: Italian pharma code. ASIN: Amazon's own identifier."
        },
        "domain": {
          "type": "string",
          "enum": [
            ".com",
            ".co.uk",
            ".de",
            ".fr",
            ".it",
            ".es",
            ".ca",
            ".com.mx",
            ".com.br",
            ".co.jp",
            ".in",
            ".com.au",
            ".ae",
            ".sa",
            ".nl",
            ".pl",
            ".se",
            ".be",
            ".com.tr",
            ".sg",
            ".ie"
          ],
          "default": ".com",
          "description": "Amazon marketplace domain extension. Determines the regional Amazon site the data is fetched from. Use the domain that matches the user's market — prices, availability and rankings differ across marketplaces."
        }
      },
      "required": [
        "identifier",
        "identifier_type"
      ],
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "get_sales_history",
    "description": "Retrieve a product's historical performance over up to 12 months: weekly aggregated trends for estimated views/traffic, sales, price, and Best Sellers Rank. This is Easyparser's 'time machine' — the deepest competitive-intelligence tool in this server.\n\nUse this tool for trend forecasting, seasonality analysis, conversion-rate estimation, and investment/sourcing due diligence. Do NOT use it for a simple current price check — get_product_detail is 5x cheaper for that.\n\nIMPORTANT cost rule: the base cost is 5 credits, and each month of history adds 1 credit (3 months = 8 credits, 12 months = 17 credits). Always ask the user how far back they need, or default to 3 months for a quick trend read. The history array in the response is aggregated by WEEK, not by day.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "asin": {
          "type": "string",
          "pattern": "^[A-Z0-9]{10}$",
          "description": "Amazon Standard Identification Number — a 10-character alphanumeric product identifier (e.g. B0CJB6V2L5). Found in the product URL after /dp/ or /gp/product/."
        },
        "domain": {
          "type": "string",
          "enum": [
            ".com",
            ".co.uk",
            ".de",
            ".fr",
            ".it",
            ".es",
            ".ca",
            ".com.mx",
            ".com.br",
            ".co.jp",
            ".in",
            ".com.au",
            ".ae",
            ".sa",
            ".nl",
            ".pl",
            ".se",
            ".be",
            ".com.tr",
            ".sg",
            ".ie"
          ],
          "default": ".com",
          "description": "Amazon marketplace domain extension. Determines the regional Amazon site the data is fetched from. Use the domain that matches the user's market — prices, availability and rankings differ across marketplaces."
        },
        "history_range": {
          "type": "string",
          "enum": [
            "0",
            "3",
            "6",
            "9",
            "12"
          ],
          "default": "0",
          "description": "Depth of historical data in months. '0' returns only the current snapshot (5 credits). '3', '6', '9', '12' add weekly history at +1 credit per month. Default '0'."
        }
      },
      "required": [
        "asin"
      ],
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "get_bestseller_rank",
    "description": "Get a product's current Best Sellers Rank (BSR): its numerical rank in main categories and sub-category node identifiers. A lightweight, single-purpose tool for popularity and demand tracking.\n\nUse this tool when you only need the rank — e.g. 'Is this product selling well?' or daily rank monitoring. Lower rank number means higher sales velocity. If you also need price, rating or content, use get_product_detail instead (it includes BSR along with everything else). For historical rank trends, use get_sales_history. Costs 1 credit.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "asin": {
          "type": "string",
          "pattern": "^[A-Z0-9]{10}$",
          "description": "Amazon Standard Identification Number — a 10-character alphanumeric product identifier (e.g. B0CJB6V2L5). Found in the product URL after /dp/ or /gp/product/."
        },
        "domain": {
          "type": "string",
          "enum": [
            ".com",
            ".co.uk",
            ".de",
            ".fr",
            ".it",
            ".es",
            ".ca",
            ".com.mx",
            ".com.br",
            ".co.jp",
            ".in",
            ".com.au",
            ".ae",
            ".sa",
            ".nl",
            ".pl",
            ".se",
            ".be",
            ".com.tr",
            ".sg",
            ".ie"
          ],
          "default": ".com",
          "description": "Amazon marketplace domain extension. Determines the regional Amazon site the data is fetched from. Use the domain that matches the user's market — prices, availability and rankings differ across marketplaces."
        }
      },
      "required": [
        "asin"
      ],
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "get_package_dimensions",
    "description": "Get a product's precise physical and logistical attributes: package height, width, length, weight, and its Amazon fee category (e.g. Computers, Apparel). This is the FBA fee-estimation and shipping-cost tool.\n\nUse this tool when the question is about shipping, storage, FBA fees, or warehouse planning. Do NOT use it for general product info — get_product_detail includes a human-readable dimensions string, but only THIS tool returns the structured fee category and exact measurements needed for fee calculation. Costs 1 credit.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "asin": {
          "type": "string",
          "pattern": "^[A-Z0-9]{10}$",
          "description": "Amazon Standard Identification Number — a 10-character alphanumeric product identifier (e.g. B0CJB6V2L5). Found in the product URL after /dp/ or /gp/product/."
        },
        "domain": {
          "type": "string",
          "enum": [
            ".com",
            ".co.uk",
            ".de",
            ".fr",
            ".it",
            ".es",
            ".ca",
            ".com.mx",
            ".com.br",
            ".co.jp",
            ".in",
            ".com.au",
            ".ae",
            ".sa",
            ".nl",
            ".pl",
            ".se",
            ".be",
            ".com.tr",
            ".sg",
            ".ie"
          ],
          "default": ".com",
          "description": "Amazon marketplace domain extension. Determines the regional Amazon site the data is fetched from. Use the domain that matches the user's market — prices, availability and rankings differ across marketplaces."
        }
      },
      "required": [
        "asin"
      ],
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "get_seller_profile",
    "description": "Unmask the legal identity and reputation of any Amazon merchant: legal business name, registered business address, and granular feedback trends over 30/90/365 days and lifetime. This is the supplier-verification and brand-protection tool.\n\nUse this tool when the user asks 'who is this seller?', 'is this merchant legitimate?', or needs a supplier's legal entity for compliance or invoicing. To see WHAT the seller sells, use get_seller_products. To read individual buyer reviews about the seller, use get_seller_feedback.\n\nProvide EITHER seller_id OR url — never both. You can discover a product's seller by calling get_product_offers first. Costs 1 credit.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "seller_id": {
          "type": "string",
          "minLength": 5,
          "description": "Amazon's unique seller identifier (e.g. A1MCYUGJD2ILFU). Found in seller profile URLs as the 'seller=' or 'me=' parameter."
        },
        "url": {
          "type": "string",
          "format": "uri",
          "description": "Full Amazon seller profile or storefront URL (e.g. https://www.amazon.com/sp?seller=A1MCYUGJD2ILFU)."
        },
        "domain": {
          "type": "string",
          "enum": [
            ".com",
            ".co.uk",
            ".de",
            ".fr",
            ".it",
            ".es",
            ".ca",
            ".com.mx",
            ".com.br",
            ".co.jp",
            ".in",
            ".com.au",
            ".ae",
            ".sa",
            ".nl",
            ".pl",
            ".se",
            ".be",
            ".com.tr",
            ".sg",
            ".ie"
          ],
          "default": ".com",
          "description": "Amazon marketplace domain extension. Determines the regional Amazon site the data is fetched from. Use the domain that matches the user's market — prices, availability and rankings differ across marketplaces."
        },
        "language": {
          "type": "string",
          "description": "Language code for the Amazon page, in locale format (e.g. en_US, de_DE, tr_TR). Affects the language of titles, descriptions and reviews in the response."
        }
      },
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "get_seller_products",
    "description": "Extract a seller's full product catalog: every ASIN they sell with brand, category, price, Prime status, variant counts, and rating data. Also returns dynamic refinement filters (department, shipping, sustainability) for drilling into the catalog.\n\nUse this tool for competitor inventory analysis, stock monitoring, and pricing-strategy research. If you need the seller's legal identity or reputation instead of their products, use get_seller_profile.\n\nEach page costs 1 credit. Start with one page and use sort_by (e.g. 'exact-aware-popularity-rank' for best sellers first) to surface the most relevant products early. Provide EITHER seller_id OR url — never both.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "seller_id": {
          "type": "string",
          "minLength": 5,
          "description": "Amazon's unique seller identifier (e.g. A1MCYUGJD2ILFU). Found in seller profile URLs as the 'seller=' or 'me=' parameter."
        },
        "url": {
          "type": "string",
          "format": "uri",
          "description": "Full Amazon seller profile or storefront URL (e.g. https://www.amazon.com/sp?seller=A1MCYUGJD2ILFU)."
        },
        "domain": {
          "type": "string",
          "enum": [
            ".com",
            ".co.uk",
            ".de",
            ".fr",
            ".it",
            ".es",
            ".ca",
            ".com.mx",
            ".com.br",
            ".co.jp",
            ".in",
            ".com.au",
            ".ae",
            ".sa",
            ".nl",
            ".pl",
            ".se",
            ".be",
            ".com.tr",
            ".sg",
            ".ie"
          ],
          "default": ".com",
          "description": "Amazon marketplace domain extension. Determines the regional Amazon site the data is fetched from. Use the domain that matches the user's market — prices, availability and rankings differ across marketplaces."
        },
        "sort_by": {
          "type": "string",
          "description": "Catalog ordering. 'featured-rank' is default; 'exact-aware-popularity-rank' sorts by popularity (best sellers first); 'price-asc-rank'/'price-desc-rank' by price; 'date-desc-rank' by newest."
        },
        "exclude_refinements": {
          "type": "boolean",
          "default": false,
          "description": "If true, omits the refinement filter list from the response, reducing payload size. Default false."
        },
        "language": {
          "type": "string",
          "description": "Language code for the Amazon page, in locale format (e.g. en_US, de_DE, tr_TR). Affects the language of titles, descriptions and reviews in the response."
        },
        "min_page": {
          "type": "integer",
          "minimum": 1,
          "default": 1,
          "description": "Starting page number. Default 1."
        },
        "max_page": {
          "type": "integer",
          "minimum": 1,
          "maximum": 5,
          "default": 1,
          "description": "Ending page number. Each page costs 1 credit; max 5 pages per request. Default 1."
        }
      },
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "get_seller_feedback",
    "description": "Read individual buyer feedback entries for an Amazon seller: star ratings, comment text, and dates — filterable by rating range and time period. This is the reputation deep-dive tool.\n\nUse this tool when the user wants to read actual buyer comments about a seller, analyze complaint patterns, or audit service quality. For aggregate reputation scores (30/90/365-day percentages) without individual comments, get_seller_profile is sufficient and cheaper in context.\n\nEach page costs 1 credit. To find dissatisfied customers, set max_rating to 3 instead of paging through everything.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "seller_id": {
          "type": "string",
          "minLength": 5,
          "description": "Amazon's unique seller identifier (e.g. A1MCYUGJD2ILFU). Found in seller profile URLs as the 'seller=' or 'me=' parameter."
        },
        "domain": {
          "type": "string",
          "enum": [
            ".com",
            ".co.uk",
            ".de",
            ".fr",
            ".it",
            ".es",
            ".ca",
            ".com.mx",
            ".com.br",
            ".co.jp",
            ".in",
            ".com.au",
            ".ae",
            ".sa",
            ".nl",
            ".pl",
            ".se",
            ".be",
            ".com.tr",
            ".sg",
            ".ie"
          ],
          "default": ".com",
          "description": "Amazon marketplace domain extension. Determines the regional Amazon site the data is fetched from. Use the domain that matches the user's market — prices, availability and rankings differ across marketplaces."
        },
        "history_range": {
          "type": "string",
          "enum": [
            "1",
            "3",
            "12",
            "all"
          ],
          "default": "all",
          "description": "Time period filter: '1' or '3' or '12' for months, 'all' for everything. Default 'all'."
        },
        "min_rating": {
          "type": "integer",
          "minimum": 1,
          "maximum": 5,
          "default": 1,
          "description": "Minimum star rating to include (1-5). Default 1."
        },
        "max_rating": {
          "type": "integer",
          "minimum": 1,
          "maximum": 5,
          "default": 5,
          "description": "Maximum star rating to include (1-5). Set to 3 to focus on negative feedback. Default 5."
        },
        "min_page": {
          "type": "integer",
          "minimum": 1,
          "default": 1,
          "description": "Starting page number. Default 1."
        },
        "max_page": {
          "type": "integer",
          "minimum": 1,
          "maximum": 5,
          "default": 1,
          "description": "Ending page number. Each page costs 1 credit; max 5 pages per request. Default 1."
        }
      },
      "required": [
        "seller_id"
      ],
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "list_operations",
    "description": "List all Easyparser operations available in this server, with their parameters, credit costs, and example use cases. Works WITHOUT an API key — call this first to understand what the server can do, or when you are unsure which tool fits the user's question. Also returns the list of supported Amazon marketplace domains.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "operation": {
          "type": "string",
          "enum": [
            "DETAIL",
            "OFFER",
            "SEARCH",
            "PRODUCT_LOOKUP",
            "SALES_ANALYSIS_HISTORY",
            "BEST_SELLERS_RANK",
            "PACKAGE_DIMENSION",
            "SELLER_PROFILE",
            "SELLER_PRODUCTS",
            "SELLER_FEEDBACK"
          ],
          "description": "Optional. Get the usage guide for one operation instead of the whole catalog."
        }
      },
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "list_bulk_jobs",
    "description": "List the user's bulk extraction jobs with their progress: operation, domain, status, total/completed/failed/invalid item counts, and timestamps. This reads the SAME data as the Bulk Requests page in the Easyparser web app — so it can see and track jobs the user started from the app UI, not just jobs submitted through this MCP server.\n\nUse this tool when the user asks about their bulk jobs: \"is my job done?\", \"what bulk jobs are running?\", \"did the DETAIL batch finish?\". Each row includes a group_id — pass it to get_bulk_job_items to drill into individual items, or to get_bulk_webhook_logs to check webhook deliveries.\n\nStatuses: pending (queued), processing (running), completed (all items succeeded), partial_success (some items failed or were dropped — check failed_items/invalid_items counts), failed. This tool is free of per-call credits (monitoring endpoints do not consume credits).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "status": {
          "type": "string",
          "enum": [
            "pending",
            "processing",
            "completed",
            "partial_success",
            "failed"
          ],
          "description": "Filter by job status: pending, processing, completed, partial_success (some items failed), failed."
        },
        "operation": {
          "type": "string",
          "enum": [
            "DETAIL",
            "OFFER",
            "SEARCH",
            "PRODUCT_LOOKUP",
            "SALES_ANALYSIS_HISTORY",
            "BEST_SELLERS_RANK",
            "PACKAGE_DIMENSION",
            "SELLER_PROFILE",
            "SELLER_PRODUCTS",
            "SELLER_FEEDBACK"
          ],
          "description": "Filter by operation type, e.g. DETAIL or SEARCH."
        },
        "domain": {
          "type": "string",
          "enum": [
            ".com",
            ".co.uk",
            ".de",
            ".fr",
            ".it",
            ".es",
            ".ca",
            ".com.mx",
            ".com.br",
            ".co.jp",
            ".in",
            ".com.au",
            ".ae",
            ".sa",
            ".nl",
            ".pl",
            ".se",
            ".be",
            ".com.tr",
            ".sg",
            ".ie"
          ],
          "description": "Filter by marketplace domain."
        },
        "bulk_request_id": {
          "type": "string",
          "description": "Look up a specific job by its bulk_request_id (returned when the job was submitted)."
        },
        "page": {
          "type": "integer",
          "minimum": 1,
          "default": 1,
          "description": "Page number. Default 1."
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 1000,
          "default": 100,
          "description": "Items per page (max 1000). Default 100."
        },
        "sort_direction": {
          "type": "string",
          "enum": [
            "asc",
            "desc"
          ],
          "default": "desc",
          "description": "Sort by creation time. 'desc' (newest first) is default."
        }
      },
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "get_bulk_job_items",
    "description": "Inspect the individual items inside a bulk job: each item's input value (ASIN, keyword, seller ID...), its status (success/failed/invalid/pending/processing), error message if it failed, credit cost, and completion time.\n\nUse this tool to debug a job after list_bulk_jobs shows failed_items or invalid_items > 0 — filter with status='failed' or status='invalid' to see exactly which inputs failed and why. Use search_key to locate one specific ASIN inside a large job. The item's item_id can be used with the Data Service (GET /v1/queries/{id}) to fetch its parsed result.\n\nThis tool is free of per-call credits (monitoring endpoints do not consume credits).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "group_id": {
          "type": "string",
          "description": "The job's group_id — get it from list_bulk_jobs (each job row has one). Identifies which job's items to inspect."
        },
        "status": {
          "type": "string",
          "enum": [
            "success",
            "invalid",
            "failed",
            "accepted",
            "pending",
            "processing"
          ],
          "description": "Filter items by outcome. Use 'failed' or 'invalid' to debug a partial_success job; omit to see everything."
        },
        "search_key": {
          "type": "string",
          "description": "Search within item values (e.g. a specific ASIN) to find one item in a large job."
        },
        "date_from": {
          "type": "string",
          "description": "ISO date lower bound, e.g. 2026-08-01."
        },
        "date_to": {
          "type": "string",
          "description": "ISO date upper bound."
        },
        "page": {
          "type": "integer",
          "minimum": 1,
          "default": 1,
          "description": "Page number. Default 1."
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 1000,
          "default": 100,
          "description": "Items per page (max 1000). Default 100."
        },
        "sort_direction": {
          "type": "string",
          "enum": [
            "asc",
            "desc"
          ],
          "default": "desc",
          "description": "Sort by creation time. 'desc' (newest first) is default."
        }
      },
      "required": [
        "group_id"
      ],
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "get_bulk_item_result",
    "description": "Fetch the parsed result data of a single bulk job item — the actual Amazon data that item produced (product detail, search results, seller profile, etc., depending on the job's operation). This is the same data shown in the item result modal on the Bulk Requests page of the web app.\n\nUse this tool after get_bulk_job_items, when the user wants to see the DATA behind a specific item, not just its status. Typical flow: list_bulk_jobs → get_bulk_job_items → get_bulk_item_result.\n\nIMPORTANT: bulk results are retained for 24 HOURS after the job completes, then they expire. If the item's data has expired, the tool returns a clear message — suggest re-running that item through the matching real-time tool (e.g. get_product_detail for a DETAIL item) to regenerate the data. This tool is free of per-call credits.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "item_id": {
          "type": "string",
          "description": "The item_id of a bulk job item — get it from get_bulk_job_items (each item row has one). This is the same ID the Data Service calls a query ID."
        }
      },
      "required": [
        "item_id"
      ],
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "get_bulk_webhook_logs",
    "description": "Check webhook delivery logs for bulk jobs: whether the completion notification was delivered to the user's callback_url, delivery status, and timestamps. Use this when a job shows as completed but the user's system never received the webhook — the classic \"job finished but my integration didn't fire\" debugging case.\n\nScope to one job with group_id (from list_bulk_jobs), or omit it to scan recent deliveries across all jobs. This tool is free of per-call credits.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "group_id": {
          "type": "string",
          "description": "Scope logs to one job's group_id. Omit to see recent webhook deliveries across all jobs."
        },
        "status": {
          "type": "string",
          "description": "Filter by delivery status (e.g. 'success', 'failed')."
        },
        "bulk_request_id": {
          "type": "string",
          "description": "Filter by the job's bulk_request_id."
        },
        "request_id": {
          "type": "string",
          "description": "Filter by an individual request ID."
        },
        "date_from": {
          "type": "string",
          "description": "ISO date lower bound."
        },
        "date_to": {
          "type": "string",
          "description": "ISO date upper bound."
        },
        "page": {
          "type": "integer",
          "minimum": 1,
          "default": 1,
          "description": "Page number. Default 1."
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 1000,
          "default": 100,
          "description": "Items per page (max 1000). Default 100."
        },
        "sort_direction": {
          "type": "string",
          "enum": [
            "asc",
            "desc"
          ],
          "default": "desc",
          "description": "Sort by creation time. 'desc' (newest first) is default."
        }
      },
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "get_error_logs",
    "description": "List the user's API request error logs — the same data shown on the Errors page of the Easyparser web app. Covers both real-time API errors and bulk job errors: each row has the platform, operation, domain, error code, channel (BULK/REALTIME), the request parameters that caused it, and a timestamp.\n\nUse this tool when the user asks about failures: \"why are my requests failing?\", \"show me recent errors\", \"any webhook errors today?\", \"what went wrong with my DETAIL calls?\". Filter by error_channel (BULK or REALTIME), error_code, operation, or domain to narrow down. Each row includes a request_id and the query_params that triggered the error, so you can trace exactly which input failed.\n\nThis tool is free of per-call credits (monitoring endpoints do not consume credits).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "error_channel": {
          "type": "string",
          "enum": [
            "BULK",
            "REALTIME"
          ],
          "description": "Filter by channel: BULK (bulk job errors) or REALTIME (real-time API errors). Omit for both."
        },
        "error_code": {
          "type": "string",
          "description": "Filter by a specific error code, e.g. 'WEBHOOK_ERROR_404' or 'SOMETHING_WENT_WRONG'."
        },
        "operation": {
          "type": "string",
          "enum": [
            "DETAIL",
            "OFFER",
            "SEARCH",
            "PRODUCT_LOOKUP",
            "SALES_ANALYSIS_HISTORY",
            "BEST_SELLERS_RANK",
            "PACKAGE_DIMENSION",
            "SELLER_PROFILE",
            "SELLER_PRODUCTS",
            "SELLER_FEEDBACK"
          ],
          "description": "Filter by operation type, e.g. DETAIL or SEARCH."
        },
        "domain": {
          "type": "string",
          "enum": [
            ".com",
            ".co.uk",
            ".de",
            ".fr",
            ".it",
            ".es",
            ".ca",
            ".com.mx",
            ".com.br",
            ".co.jp",
            ".in",
            ".com.au",
            ".ae",
            ".sa",
            ".nl",
            ".pl",
            ".se",
            ".be",
            ".com.tr",
            ".sg",
            ".ie"
          ],
          "description": "Filter by marketplace domain."
        },
        "platform": {
          "type": "string",
          "description": "Filter by platform (e.g. 'AMZ')."
        },
        "date_from": {
          "type": "string",
          "description": "ISO date lower bound, e.g. 2026-08-01."
        },
        "date_to": {
          "type": "string",
          "description": "ISO date upper bound."
        },
        "order_by": {
          "type": "string",
          "enum": [
            "create_date",
            "error_channel",
            "error_code",
            "platform",
            "domain",
            "operation"
          ],
          "default": "create_date",
          "description": "Sort field. Default 'create_date'."
        },
        "order_type": {
          "type": "string",
          "enum": [
            "asc",
            "desc"
          ],
          "default": "desc",
          "description": "Sort direction. 'desc' (newest first) is default."
        },
        "page": {
          "type": "integer",
          "minimum": 1,
          "default": 1,
          "description": "Page number. Default 1."
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 1000,
          "default": 100,
          "description": "Items per page (max 1000). Default 100."
        }
      },
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "check_credits",
    "description": "Check the Easyparser account: current plan, credit balance (used/remaining/limit), credit reset date, per-minute rate limits, and this month's daily usage breakdown by operation. FREE — this calls the Account API and consumes no credits.\n\nUse this before running expensive multi-page or 12-month-history jobs, when the user asks about their quota or plan, or to analyze usage patterns (e.g. 'which operation consumed the most credits this month?'). Requires an API key.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  }
];

export const TOOL_NAMES = TOOL_DEFS.map((t) => t.name);

/** Whether `name` is one of the captured tools. */
export function isKnownTool(name: string): boolean {
  return TOOL_NAMES.includes(name);
}

/* ------------------------------------------------------------------ */
/* Forwarding client                                                   */
/* ------------------------------------------------------------------ */

function errorResult(detail: string): ToolResult {
  return {
    content: [{ type: "text", text: `asinlens error: ${detail}` }],
    isError: true,
  };
}

function rpcErrorMessage(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message !== "") return message;
    return JSON.stringify(error);
  }
  return String(error);
}

/**
 * Parse a JSON-RPC response body, tolerating SSE framing.
 * Returns the message whose id matches `expectedId` when
 * one is present, else the last parseable message, else
 * null when nothing parses.
 */
export function parseRpcBody(
  text: string,
  expectedId?: number,
): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const candidates: Record<string, unknown>[] = [];
  const tryPush = (payload: string): void => {
    try {
      const parsed: unknown = JSON.parse(payload);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        candidates.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Not JSON; ignore this candidate.
    }
  };
  if (trimmed.includes("data:")) {
    for (const line of trimmed.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice("data:".length).trim();
      if (payload !== "" && payload !== "[DONE]") tryPush(payload);
    }
  } else {
    tryPush(trimmed);
  }
  if (candidates.length === 0) return null;
  if (expectedId !== undefined) {
    const match = candidates.find((c) => c.id === expectedId);
    if (match !== undefined) return match;
  }
  return candidates[candidates.length - 1];
}

async function defaultFetch(
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
): Promise<FetchResponseLike> {
  return fetch(url, init) as unknown as FetchResponseLike;
}

/**
 * A forwarding client holding one upstream session. The
 * session is established lazily on the first forwarded
 * call and reused for the lifetime of the client (the
 * process lifetime when the client is the MCP server's
 * or a one-shot client for the CLI).
 */
export class AsinlensClient {
  private readonly deps: ForwardDeps;
  private sessionId: string | null = null;
  private ready = false;
  private sessionPromise: Promise<void> | null = null;
  private idCounter = 0;

  constructor(deps: ForwardDeps = {}) {
    this.deps = deps;
  }

  private fetchFn(): FetchFn {
    return this.deps.fetchFn ?? defaultFetch;
  }

  private endpointUrl(): string {
    if (this.deps.url && this.deps.url.trim() !== "") return this.deps.url.trim();
    const raw = (this.deps.env ?? process.env).EASYPARSER_MCP_URL;
    if (raw && raw.trim() !== "") return raw.trim();
    return DEFAULT_ENDPOINT_URL;
  }

  private apiKey(): string | null {
    const raw = (this.deps.env ?? process.env).EASYPARSER_API_KEY;
    if (raw && raw.trim() !== "") return raw.trim();
    return null;
  }

  private timeoutMs(): number {
    if (typeof this.deps.timeoutMs === "number" && this.deps.timeoutMs > 0) {
      return this.deps.timeoutMs;
    }
    return DEFAULT_TIMEOUT_MS;
  }

  private nextId(): number {
    this.idCounter += 1;
    return this.idCounter;
  }

  private async post(
    body: unknown,
    withSession: boolean,
  ): Promise<FetchResponseLike> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    const key = this.apiKey();
    if (key !== null) headers["Authorization"] = `Bearer ${key}`;
    if (withSession && this.sessionId !== null) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs());
    try {
      return await this.fetchFn()(this.endpointUrl(), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async ensureSession(): Promise<void> {
    if (this.ready) return;
    if (this.sessionPromise === null) {
      this.sessionPromise = (async () => {
        const initId = this.nextId();
        const initRes = await this.post(
          {
            jsonrpc: "2.0",
            id: initId,
            method: "initialize",
            params: {
              protocolVersion: PROTOCOL_VERSION,
              capabilities: {},
              clientInfo: { name: "asinlens", version: VERSION },
            },
          },
          false,
        );
        const sessionId = initRes.headers.get("mcp-session-id");
        if (sessionId) this.sessionId = sessionId;
        const initText = await initRes.text();
        const initParsed = parseRpcBody(initText, initId);
        if (initParsed !== null && initParsed.error) {
          throw new Error(rpcErrorMessage(initParsed.error));
        }
        if (initRes.status < 200 || initRes.status >= 300) {
          throw new Error(`HTTP ${initRes.status}`);
        }
        if (initParsed === null && initText.trim() !== "") {
          throw new Error("malformed response");
        }
        const initializedRes = await this.post(
          { jsonrpc: "2.0", method: "notifications/initialized" },
          true,
        );
        try {
          await initializedRes.text();
        } catch {
          // The notification response body carries nothing we need.
        }
        this.ready = true;
      })();
    }
    try {
      await this.sessionPromise;
    } catch (err) {
      this.sessionPromise = null;
      this.sessionId = null;
      throw err;
    }
  }

  /** Forward one tool call; upstream failures come back as isError results. */
  async callTool(name: string, args: ToolArgs): Promise<ToolResult> {
    try {
      await this.ensureSession();
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }

    const callId = this.nextId();
    let callRes: FetchResponseLike;
    try {
      callRes = await this.post(
        {
          jsonrpc: "2.0",
          id: callId,
          method: "tools/call",
          params: { name, arguments: args ?? {} },
        },
        true,
      );
    } catch (err) {
      return errorResult(
        `request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const parsed = parseRpcBody(await callRes.text(), callId);
    if (parsed !== null && parsed.error) {
      return errorResult(rpcErrorMessage(parsed.error));
    }
    if (callRes.status < 200 || callRes.status >= 300) {
      return errorResult(`HTTP ${callRes.status}`);
    }
    if (parsed === null) return errorResult("malformed response");
    const result = parsed.result as ToolResult | undefined;
    if (result === undefined || result === null || typeof result !== "object") {
      return errorResult("malformed response");
    }
    // Pass the upstream result through verbatim.
    return result;
  }
}

/** Create a forwarding client; tests inject a fake fetch and env through deps. */
export function createClient(deps: ForwardDeps = {}): AsinlensClient {
  return new AsinlensClient(deps);
}

/** One-shot helper: a fresh client per call (the CLI path). */
export async function callTool(
  name: string,
  args: ToolArgs,
  deps: ForwardDeps = {},
): Promise<ToolResult> {
  return new AsinlensClient(deps).callTool(name, args);
}
