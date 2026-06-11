import type { ToolDefinition, ToolHandler, ToolContext } from "../types"
import { requestTool, batchRequestTool } from "./requester"
import { crawlTool } from "./crawler"
import { loginTool } from "./auth"
import { analyzeTool } from "./analyzer"
import { generatePayloadTool } from "./payload"
import { checkHeadersTool } from "./header-scanner"
import { discoverTool } from "./discover"
import { askUserTool, detectFormsTool } from "./interactive"
import { reportTool, Reporter } from "./reporter"

export interface ToolRegistryEntry {
  definition: ToolDefinition
  handler: ToolHandler
}

export function createRegistry(reporter: Reporter): {
  definitions: ToolDefinition[]
  execute: (name: string, args: Record<string, unknown>, ctx: ToolContext) => Promise<string>
} {
  const registry = new Map<string, ToolRegistryEntry>()

  function register(name: string, description: string, parameters: Record<string, unknown>, handler: ToolHandler) {
    registry.set(name, {
      definition: {
        type: "function",
        function: { name, description, parameters },
      },
      handler,
    })
  }

  register(
    "crawl",
    "Crawl website from a starting URL, return all discovered same-domain URLs. Use this first to discover pages.",
    {
      type: "object",
      properties: {
        url: { type: "string", description: "Starting URL to crawl (default: target URL)" },
        max_urls: { type: "number", description: "Maximum URLs to discover (default: 500)" },
        depth: { type: "number", description: "Crawl depth (default: 2)" },
      },
      required: [],
    } as any,
    crawlTool,
  )

  register(
    "request",
    "Send HTTP GET or POST request to a URL. Returns status code, headers, and response body. Use this to test pages for errors.",
    {
      type: "object",
      properties: {
        url: { type: "string", description: "Full URL to request" },
        method: { type: "string", enum: ["GET", "POST"], description: "HTTP method" },
        body: { type: "string", description: "Request body for POST requests (form-encoded or raw)" },
        headers: { type: "object", description: "Additional HTTP headers" },
      },
      required: ["url", "method"],
    } as any,
    requestTool,
  )

  register(
    "batch_request",
    "Test multiple URLs at once with GET requests (max 10). Faster than calling request individually.",
    {
      type: "object",
      properties: {
        urls: { type: "array", items: { type: "string" }, description: "Array of URLs to test" },
        method: { type: "string", enum: ["GET", "POST"], description: "HTTP method" },
      },
      required: ["urls", "method"],
    } as any,
    batchRequestTool,
  )

  register(
    "login",
    "Log into the target website using form-based authentication. Detects login form automatically.",
    {
      type: "object",
      properties: {
        login_url: { type: "string", description: "Login page URL (default: auto-detect from target)" },
        username: { type: "string", description: "Login username" },
        password: { type: "string", description: "Login password" },
      },
      required: [],
    } as any,
    loginTool,
  )

  register(
    "analyze",
    "Analyze an HTTP response to determine if it's an error page. Detects both status-code errors and fake-200 error pages.",
    {
      type: "object",
      properties: {
        html: { type: "string", description: "HTML content of the response" },
        status_code: { type: "number", description: "HTTP status code" },
        url: { type: "string", description: "Original URL (for reference)" },
      },
      required: ["html", "status_code"],
    } as any,
    analyzeTool,
  )

  register(
    "generate_payload",
    "Generate POST payloads for testing. Given form field descriptions, creates payloads for various attack strategies.",
    {
      type: "object",
      properties: {
        form_fields: { type: "string", description: "Form fields description, format: field_name:field_type per line (e.g. 'username:text\\npassword:password')" },
        strategy: { type: "string", enum: ["empty", "invalid_type", "xss", "sqli", "overflow"], description: "Test strategy" },
      },
      required: ["form_fields", "strategy"],
    } as any,
    generatePayloadTool,
  )

  register(
    "check_headers",
    "Analyze HTTP response headers for security issues. Checks for missing or misconfigured security headers like HSTS, CSP, X-Frame-Options, etc. Pass the headers object from a request() response.",
    {
      type: "object",
      properties: {
        headers: {
          type: "object",
          description: "HTTP response headers object (from request() result). Can also be a JSON string.",
        },
        url: { type: "string", description: "Original URL for reference" },
      },
      required: ["headers"],
    } as any,
    checkHeadersTool,
  )

  register(
    "discover",
    "Discover URLs and entry points from a host. Checks robots.txt, sitemap.xml, common paths (admin, api, login, etc.), and homepage links. Returns all discovered URLs and detects login forms.",
    {
      type: "object",
      properties: {
        url: { type: "string", description: "Host URL to discover (default: target URL)" },
      },
      required: [],
    } as any,
    discoverTool,
  )

  register(
    "detect_forms",
    "Find and analyze all HTML forms on a page. Detects login forms vs regular forms, shows form fields, actions, and methods.",
    {
      type: "object",
      properties: {
        url: { type: "string", description: "Page URL to scan for forms (default: target URL)" },
      },
      required: [],
    } as any,
    detectFormsTool,
  )

  register(
    "ask_user",
    "Ask the user a question and get their answer interactively. Use this when you need information from the user, like which credentials to use for login, or confirmation before proceeding.",
    {
      type: "object",
      properties: {
        question: { type: "string", description: "The question to ask the user" },
        kind: {
          type: "string",
          enum: ["text", "confirm", "choice", "credentials"],
          description: "Type of input: text (default), confirm (yes/no), choice (pick from options), credentials (username:password)",
        },
        options: {
          type: "array",
          items: { type: "string" },
          description: "Choices for 'choice' kind",
        },
      },
      required: ["question"],
    } as any,
    askUserTool,
  )

  register(
    "report",
    "Record a discovered error page. Always call this when you find a 4xx, 5xx, or fake-200 error.",
    {
      type: "object",
      properties: {
        url: { type: "string", description: "URL that returned the error" },
        status_code: { type: "number", description: "HTTP status code" },
        method: { type: "string", description: "HTTP method used" },
        error_type: { type: "string", description: "Error type: 400, 403, 404, 500, 503, fake_200_error, etc." },
        confidence: { type: "number", description: "Confidence level 0-1" },
        details: { type: "string", description: "Details about the error" },
      },
      required: ["url", "status_code", "error_type"],
    } as any,
    reportTool(reporter),
  )

  const definitions = Array.from(registry.values()).map(e => e.definition)

  async function execute(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const entry = registry.get(name)
    if (!entry) return `Error: Unknown tool "${name}". Available tools: ${definitions.map(d => d.function.name).join(", ")}`
    try {
      return await entry.handler(args, ctx)
    } catch (err: any) {
      return `Error executing ${name}: ${err?.message || String(err)}`
    }
  }

  return { definitions, execute }
}
