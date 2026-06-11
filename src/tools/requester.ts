import type { ToolHandler, RequestResult } from "../types"

async function doRequest(
  url: string,
  method: string,
  body: string | undefined,
  headers: Record<string, string> | undefined,
  cookieHeader: string,
  timeout = 15000,
): Promise<RequestResult> {
  const reqHeaders: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    ...headers,
  }

  if (cookieHeader) {
    reqHeaders["Cookie"] = cookieHeader
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  try {
    const fetchOpts: RequestInit = {
      method,
      headers: reqHeaders,
      signal: controller.signal,
      redirect: "follow",
    }

    if (body && method === "POST") {
      fetchOpts.body = body
    }

    const response = await fetch(url, fetchOpts)
    const respHeaders: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      respHeaders[key.toLowerCase()] = value
    })

    let textBody = await response.text()
    const bodyLength = textBody.length
    if (textBody.length > 3000) {
      textBody = textBody.substring(0, 3000) + "\n\n...[TRUNCATED]"
    }

    const statusText = getStatusText(response.status)

    return {
      status: response.status,
      status_text: statusText,
      headers: respHeaders,
      body: textBody,
      body_length: bodyLength,
      url,
      redirected: response.redirected,
      final_url: response.url,
    }
  } catch (err: any) {
    const errMsg = err?.message || String(err)
    return {
      status: 0,
      status_text: "ERROR",
      headers: {},
      body: `Request failed: ${errMsg}`,
      body_length: 0,
      url,
    }
  } finally {
    clearTimeout(timer)
  }
}

function getStatusText(status: number): string {
  const codes: Record<number, string> = {
    200: "OK", 201: "Created", 204: "No Content",
    301: "Moved Permanently", 302: "Found", 303: "See Other", 307: "Temporary Redirect", 308: "Permanent Redirect",
    400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
    405: "Method Not Allowed", 429: "Too Many Requests",
    500: "Internal Server Error", 502: "Bad Gateway", 503: "Service Unavailable", 504: "Gateway Timeout",
  }
  return codes[status] || `Status ${status}`
}

export const requestTool: ToolHandler = async (args, ctx) => {
  const url = args.url as string
  const method = (args.method as string) || "GET"
  const body = args.body as string | undefined
  const headers = args.headers as Record<string, string> | undefined

  if (!url) return "Error: url is required"

  const cookieHeader = ctx.cookieJar.getCookieHeader(url)
  const result = await doRequest(url, method, body, headers, cookieHeader, 15000)

  if (result.headers["set-cookie"]) {
    ctx.cookieJar.setCookie(url, result.headers["set-cookie"])
  }

  return JSON.stringify(result, null, 2)
}

export const batchRequestTool: ToolHandler = async (args, ctx) => {
  const urls = args.urls as string[]
  const method = (args.method as string) || "GET"

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return "Error: urls array is required"
  }

  const batch = urls.slice(0, 10)
  const results = await Promise.all(
    batch.map(async (url) => {
      const cookieHeader = ctx.cookieJar.getCookieHeader(url)
      const result = await doRequest(url, method, undefined, undefined, cookieHeader, 15000)
      return {
        url,
        status: result.status,
        status_text: result.status_text,
        body_length: result.body_length,
        body_preview: result.body.substring(0, 500),
      }
    }),
  )

  return JSON.stringify(results, null, 2)
}
