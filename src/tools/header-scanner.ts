import type { ToolHandler } from "../types"

interface HeaderCheck {
  header: string
  display_name: string
  severity: "HIGH" | "MEDIUM" | "LOW" | "INFO"
  description: string
  expected: string
  check: (value: string | undefined) => { pass: boolean; message: string }
}

const SECURITY_HEADER_CHECKS: HeaderCheck[] = [
  {
    header: "strict-transport-security",
    display_name: "Strict-Transport-Security (HSTS)",
    severity: "HIGH",
    description: "Forces HTTPS connections and prevents downgrade attacks",
    expected: "max-age=31536000 or higher, includeSubDomains recommended",
    check: (value) => {
      if (!value) return { pass: false, message: "Missing HSTS header - site may be vulnerable to SSL stripping" }
      const maxAge = parseInt(value.match(/max-age=(\d+)/i)?.[1] || "0")
      if (maxAge < 31536000) return { pass: false, message: `HSTS max-age too low (${maxAge}s), recommended ≥ 31536000s (1 year)` }
      return { pass: true, message: `HSTS configured with max-age=${maxAge}s${value.includes("includeSubDomains") ? " + includeSubDomains" : ""}` }
    },
  },
  {
    header: "content-security-policy",
    display_name: "Content-Security-Policy (CSP)",
    severity: "HIGH",
    description: "Controls resources the browser can load, prevents XSS",
    expected: "Configured with restrictive directives",
    check: (value) => {
      if (!value) return { pass: false, message: "Missing CSP header - vulnerable to XSS and data injection" }
      if (value.includes("default-src 'none'")) return { pass: true, message: "CSP: strict policy (default-src 'none')" }
      if (value.includes("unsafe-inline") && !value.includes("nonce") && !value.includes("hash")) {
        return { pass: false, message: "CSP allows 'unsafe-inline' without nonce/hash - weak XSS protection" }
      }
      if (value.includes("*")) return { pass: false, message: "CSP uses wildcard (*) - too permissive" }
      return { pass: true, message: "CSP configured (review directives for completeness)" }
    },
  },
  {
    header: "x-frame-options",
    display_name: "X-Frame-Options",
    severity: "MEDIUM",
    description: "Prevents clickjacking by controlling iframe embedding",
    expected: "DENY or SAMEORIGIN",
    check: (value) => {
      if (!value) return { pass: false, message: "Missing X-Frame-Options - site may be vulnerable to clickjacking" }
      if (value.toUpperCase() === "DENY") return { pass: true, message: "X-Frame-Options: DENY (most restrictive)" }
      if (value.toUpperCase() === "SAMEORIGIN") return { pass: true, message: "X-Frame-Options: SAMEORIGIN" }
      return { pass: false, message: `X-Frame-Options: ${value} - consider using DENY or SAMEORIGIN` }
    },
  },
  {
    header: "x-content-type-options",
    display_name: "X-Content-Type-Options",
    severity: "MEDIUM",
    description: "Prevents MIME type sniffing attacks",
    expected: "nosniff",
    check: (value) => {
      if (!value) return { pass: false, message: "Missing X-Content-Type-Options - browser may sniff MIME types" }
      if (value.toLowerCase() === "nosniff") return { pass: true, message: "X-Content-Type-Options: nosniff" }
      return { pass: false, message: `X-Content-Type-Options: ${value} - expected 'nosniff'` }
    },
  },
  {
    header: "referrer-policy",
    display_name: "Referrer-Policy",
    severity: "LOW",
    description: "Controls how much referrer info is sent with requests",
    expected: "strict-origin-when-cross-origin or stricter",
    check: (value) => {
      if (!value) return { pass: false, message: "Missing Referrer-Policy - browser default may leak referrer info" }
      const strict = ["no-referrer", "same-origin", "strict-origin", "strict-origin-when-cross-origin"]
      if (strict.includes(value.toLowerCase())) return { pass: true, message: `Referrer-Policy: ${value} (good)` }
      return { pass: false, message: `Referrer-Policy: ${value} - may leak referrer info` }
    },
  },
  {
    header: "permissions-policy",
    display_name: "Permissions-Policy",
    severity: "LOW",
    description: "Controls browser features (camera, mic, etc.)",
    expected: "Configured to limit unnecessary features",
    check: (value) => {
      if (!value) return { pass: false, message: "Missing Permissions-Policy (or Feature-Policy) - all browser features allowed" }
      return { pass: true, message: "Permissions-Policy configured" }
    },
  },
  {
    header: "cache-control",
    display_name: "Cache-Control",
    severity: "MEDIUM",
    description: "Controls caching behavior for sensitive pages",
    expected: "no-store, no-cache, private for sensitive pages",
    check: (value) => {
      if (!value) return { pass: false, message: "Missing Cache-Control" }
      if (value.includes("no-store")) return { pass: true, message: "Cache-Control: includes no-store (good for sensitive pages)" }
      return { pass: false, message: `Cache-Control: ${value} - consider adding 'no-store' for sensitive pages` }
    },
  },
  {
    header: "access-control-allow-origin",
    display_name: "CORS (Access-Control-Allow-Origin)",
    severity: "MEDIUM",
    description: "Controls cross-origin resource sharing",
    expected: "Specific origin or not present on non-API pages",
    check: (value) => {
      if (!value) return { pass: true, message: "No CORS header (default: same-origin only)" }
      if (value === "*") return { pass: false, message: "CORS allows all origins (*) - potential data exposure" }
      return { pass: false, message: `CORS: ${value} - verify this is intentional` }
    },
  },
]

const INFO_LEAK_HEADERS = [
  {
    header: "server",
    display_name: "Server",
    severity: "LOW",
    description: "Reveals server software version - information disclosure",
    expected: "Minimal or no version info",
  },
  {
    header: "x-powered-by",
    display_name: "X-Powered-By",
    severity: "LOW",
    description: "Reveals technology stack - information disclosure",
    expected: "Should be removed in production",
  },
  {
    header: "x-aspnet-version",
    display_name: "X-AspNet-Version",
    severity: "LOW",
    description: "Reveals ASP.NET version - information disclosure",
    expected: "Should be removed in production",
  },
]

export const checkHeadersTool: ToolHandler = async (args) => {
  const headersRaw = args.headers as string | Record<string, string> | undefined
  const url = (args.url as string) || "unknown"

  if (!headersRaw) {
    return "Error: headers parameter is required (object or JSON string)"
  }

  let headers: Record<string, string>
  if (typeof headersRaw === "string") {
    try { headers = JSON.parse(headersRaw) } catch { return "Error: headers must be a valid JSON object or string" }
  } else {
    headers = headersRaw
  }

  const headersLower: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    headersLower[k.toLowerCase()] = v
  }

  const results: {
    security_headers: any[]
    info_disclosure: any[]
    score: { passed: number; failed: number; total: number; percentage: number }
  } = {
    security_headers: [],
    info_disclosure: [],
    score: { passed: 0, failed: 0, total: 0, percentage: 0 },
  }

  for (const check of SECURITY_HEADER_CHECKS) {
    const value = headersLower[check.header]
    const result = check.check(value)
    results.security_headers.push({
      header: check.display_name,
      expected: check.expected,
      found: value || "(missing)",
      severity: check.severity,
      pass: result.pass,
      message: result.message,
    })
    if (result.pass) results.score.passed++
    else results.score.failed++
    results.score.total++
  }

  for (const leak of INFO_LEAK_HEADERS) {
    const value = headersLower[leak.header]
    if (value) {
      results.info_disclosure.push({
        header: leak.display_name,
        found: value,
        severity: leak.severity,
        description: leak.description,
      })
      results.score.failed++
      results.score.total++
    }
  }

  results.score.percentage = results.score.total > 0
    ? Math.round((results.score.passed / results.score.total) * 100)
    : 0

  const summary = results.info_disclosure.length > 0
    ? `Also found ${results.info_disclosure.length} information disclosure header(s)`
    : "No information disclosure headers detected"

  return JSON.stringify({
    url,
    score: results.score,
    summary: `Security header score: ${results.score.passed}/${results.score.total} (${results.score.percentage}%) - ${results.score.failed} issue(s) found. ${summary}`,
    details: results,
  }, null, 2)
}
