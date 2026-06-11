import type { ToolHandler, AnalysisResult } from "../types"

function isErrorStatus(status: number): string | null {
  if (status >= 400 && status < 500) return `${status}`
  if (status >= 500 && status < 600) return `${status}`
  return null
}

function analyzeHtmlContent(html: string): { is_error: boolean; type: string; confidence: number; reason: string } {
  const htmlLower = html.toLowerCase()

  const errorPatterns: { pattern: RegExp; type: string; weight: number }[] = [
    { pattern: /internal server error/i, type: "500", weight: 0.9 },
    { pattern: /500\s+internal server error/i, type: "500", weight: 0.95 },
    { pattern: /service unavailable/i, type: "503", weight: 0.9 },
    { pattern: /503\s+service unavailable/i, type: "503", weight: 0.95 },
    { pattern: /bad gateway/i, type: "502", weight: 0.9 },
    { pattern: /404\s+not found/i, type: "404", weight: 0.95 },
    { pattern: /page not found/i, type: "404", weight: 0.85 },
    { pattern: /not found/i, type: "404", weight: 0.7 },
    { pattern: /forbidden/i, type: "403", weight: 0.8 },
    { pattern: /access denied/i, type: "403", weight: 0.85 },
    { pattern: /bad request/i, type: "400", weight: 0.85 },
    { pattern: /400\s+bad request/i, type: "400", weight: 0.95 },
    { pattern: /something went wrong/i, type: "500", weight: 0.7 },
    { pattern: /an error occurred/i, type: "500", weight: 0.65 },
    { pattern: /unexpected error/i, type: "500", weight: 0.7 },
    { pattern: /stack trace/i, type: "500", weight: 0.85 },
    { pattern: /cannot find/i, type: "404", weight: 0.5 },
    { pattern: /could not find/i, type: "404", weight: 0.5 },
    { pattern: /doesn.t exist/i, type: "404", weight: 0.5 },
    { pattern: /method not allowed/i, type: "405", weight: 0.85 },
    { pattern: /too many requests/i, type: "429", weight: 0.85 },
    { pattern: /syntaxerror/i, type: "500", weight: 0.7 },
    { pattern: /typeerror/i, type: "500", weight: 0.6 },
    { pattern: /referenceerror/i, type: "500", weight: 0.6 },
    { pattern: /exception/i, type: "500", weight: 0.5 },
    { pattern: /warning.*line\s+\d+/i, type: "500", weight: 0.5 },
  ]

  let bestMatch = { type: "", confidence: 0, reason: "" }

  for (const { pattern, type, weight } of errorPatterns) {
    const match = htmlLower.match(pattern)
    if (match) {
      if (weight > bestMatch.confidence) {
        bestMatch = {
          type,
          confidence: weight,
          reason: `Matched pattern: "${match[0]}"`,
        }
      }
    }
  }

  if (bestMatch.confidence > 0) {
    return { is_error: true, ...bestMatch }
  }

  const errorTitlePatterns = [
    /<title[^>]*>(error|not.found|500|503|403|404|400|bad.request|forbidden|access.denied)[^<]*<\/title>/i,
    /<h[1-4][^>]*>(error|not.found|500|503|403|404|400)[^<]*<\/h[1-4]>/i,
  ]
  for (const pat of errorTitlePatterns) {
    const match = htmlLower.match(pat)
    if (match) {
      return { is_error: true, type: "unknown_error", confidence: 0.6, reason: `Title/heading suggests error: "${match[1]}"` }
    }
  }

  return { is_error: false, type: "normal", confidence: 0.95, reason: "No error indicators found" }
}

export const analyzeTool: ToolHandler = async (args, _ctx) => {
  const html = (args.html as string) || ""
  const statusCode = (args.status_code as number) || 0
  const url = (args.url as string) || "unknown"

  const statusError = isErrorStatus(statusCode)

  const contentAnalysis = analyzeHtmlContent(html)

  let result: AnalysisResult

  if (statusError) {
    result = {
      is_error: true,
      error_type: statusError,
      confidence: contentAnalysis.is_error
        ? Math.max(0.95, contentAnalysis.confidence)
        : 0.9,
      reason: contentAnalysis.is_error
        ? `HTTP ${statusError} + ${contentAnalysis.reason}`
        : `HTTP ${statusError} status code (no error content detected)`,
      status_code: statusCode,
    }
  } else if (contentAnalysis.is_error) {
    result = {
      is_error: true,
      error_type: `fake_200_${contentAnalysis.type}`,
      confidence: contentAnalysis.confidence * 0.8,
      reason: `Status 200 but content suggests ${contentAnalysis.type} error: ${contentAnalysis.reason}`,
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
