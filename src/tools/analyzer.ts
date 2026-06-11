import type { ToolHandler, AnalysisResult } from "../types"

function isErrorStatus(status: number): string | null {
  if (status >= 400 && status < 500) return `${status}`
  if (status >= 500 && status < 600) return `${status}`
  return null
}

function statusCategory(status: number): "client" | "server" | "none" {
  if (status >= 400 && status < 500) return "client"
  if (status >= 500 && status < 600) return "server"
  return "none"
}

const ERROR_PATTERNS: { pattern: RegExp; type: string; weight: number; category: "client" | "server" }[] = [
  { pattern: /internal server error/i, type: "500", weight: 0.9, category: "server" },
  { pattern: /500\s+internal server error/i, type: "500", weight: 0.95, category: "server" },
  { pattern: /service unavailable/i, type: "503", weight: 0.9, category: "server" },
  { pattern: /503\s+service unavailable/i, type: "503", weight: 0.95, category: "server" },
  { pattern: /bad gateway/i, type: "502", weight: 0.9, category: "server" },
  { pattern: /404\s+not found/i, type: "404", weight: 0.95, category: "client" },
  { pattern: /page not found/i, type: "404", weight: 0.85, category: "client" },
  { pattern: /not found/i, type: "404", weight: 0.7, category: "client" },
  { pattern: /forbidden/i, type: "403", weight: 0.8, category: "client" },
  { pattern: /access denied/i, type: "403", weight: 0.85, category: "client" },
  { pattern: /bad request/i, type: "400", weight: 0.85, category: "client" },
  { pattern: /400\s+bad request/i, type: "400", weight: 0.95, category: "client" },
  { pattern: /something went wrong/i, type: "500", weight: 0.7, category: "server" },
  { pattern: /an error occurred/i, type: "500", weight: 0.65, category: "server" },
  { pattern: /unexpected error/i, type: "500", weight: 0.7, category: "server" },
  { pattern: /stack trace/i, type: "500", weight: 0.85, category: "server" },
  { pattern: /cannot find/i, type: "404", weight: 0.5, category: "client" },
  { pattern: /could not find/i, type: "404", weight: 0.5, category: "client" },
  { pattern: /doesn.t exist/i, type: "404", weight: 0.5, category: "client" },
  { pattern: /method not allowed/i, type: "405", weight: 0.85, category: "client" },
  { pattern: /too many requests/i, type: "429", weight: 0.85, category: "client" },
  { pattern: /syntaxerror/i, type: "500", weight: 0.7, category: "server" },
  { pattern: /typeerror/i, type: "500", weight: 0.6, category: "server" },
  { pattern: /referenceerror/i, type: "500", weight: 0.6, category: "server" },
  { pattern: /exception/i, type: "500", weight: 0.5, category: "server" },
  { pattern: /warning.*line\s+\d+/i, type: "500", weight: 0.5, category: "server" },
]

function getCategoryFromType(type: string): "client" | "server" {
  const code = parseInt(type)
  if (code >= 400 && code < 500) return "client"
  if (code >= 500 && code < 600) return "server"
  return "server"
}

function analyzeHtmlContent(html: string, statusCode: number): { is_error: boolean; type: string; confidence: number; reason: string } {
  const htmlLower = html.toLowerCase()
  const cat = statusCategory(statusCode)

  let bestMatch = { type: "", confidence: 0, reason: "" }

  for (const { pattern, type, weight, category } of ERROR_PATTERNS) {
    const match = htmlLower.match(pattern)
    if (!match) continue

    if (cat !== "none" && category !== cat) {
      if (weight < 0.7) continue
      if (cat === "client") {
        continue
      }
    }

    if (weight > bestMatch.confidence) {
      bestMatch = {
        type,
        confidence: weight,
        reason: `Matched pattern: "${match[0]}"`,
      }
    }
  }

  if (bestMatch.confidence > 0) {
    return { is_error: true, ...bestMatch }
  }

  if (cat === "none") {
    const errorTitlePatterns = [
      /<title[^>]*>(error|not.found|500|503|403|404|400|bad.request|forbidden|access.denied)[^<]*<\/title>/i,
      /<h[1-4][^>]*>(error|not.found|500|503|403|404|400)[^<]*<\/h[1-4]>/i,
    ]
    for (const pat of errorTitlePatterns) {
      const match = htmlLower.match(pat)
      if (match) {
        const type = (match[1] || "").toLowerCase()
        const mappedType = type === "error" ? "500" : type.replace(/[.\s]/g, "")
        const normType = parseInt(mappedType) > 0 ? mappedType : "unknown_error"
        return { is_error: true, type: normType, confidence: 0.6, reason: `Title/heading suggests error: "${match[0]}"` }
      }
    }
  }

  return { is_error: false, type: "normal", confidence: 0.95, reason: "No error indicators found" }
}

export const analyzeTool: ToolHandler = async (args, _ctx) => {
  const html = (args.html as string) || ""
  const statusCode = (args.status_code as number) || 0
  const url = (args.url as string) || "unknown"

  const statusError = isErrorStatus(statusCode)
  const category = statusCategory(statusCode)

  const contentAnalysis = analyzeHtmlContent(html, statusCode)
  const contentCategory = contentAnalysis.is_error ? getCategoryFromType(contentAnalysis.type) : null

  let result: AnalysisResult

  if (statusError) {
    const contentMatchesCategory = contentCategory === category
    result = {
      is_error: true,
      error_type: statusError,
      confidence: 0.97,
      reason: contentMatchesCategory
        ? `HTTP ${statusError} + content confirms (${contentAnalysis.reason})`
        : `HTTP ${statusError} status code`,
      status_code: statusCode,
    }
  } else if (contentAnalysis.is_error) {
    result = {
      is_error: true,
      error_type: `fake_200_${contentAnalysis.type}`,
      confidence: contentAnalysis.confidence * 0.8,
      reason: `Status 200 but content suggests ${contentAnalysis.type} error`,
      status_code: statusCode,
    }
  } else {
    result = {
      is_error: false,
      error_type: "normal",
      confidence: 0.95,
      reason: "Page appears normal",
      status_code: statusCode,
    }
  }

  return JSON.stringify(result, null, 2)
}
