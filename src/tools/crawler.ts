import * as cheerio from "cheerio"
import type { ToolHandler } from "../types"

export const crawlTool: ToolHandler = async (args, ctx) => {
  const startUrl = (args.url as string) || ctx.config.target_url
  const maxUrls = (args.max_urls as number) || ctx.config.max_urls
  const depth = (args.depth as number) || ctx.config.max_depth

  if (!startUrl) return "Error: url is required"

  const baseUrl = new URL(startUrl)
  const baseOrigin = baseUrl.origin
  const discovered = new Set<string>()
  const visited = new Set<string>()
  const toVisit: { url: string; depth: number }[] = [{ url: startUrl, depth: 0 }]

  discovered.add(startUrl)

  while (toVisit.length > 0 && discovered.size < maxUrls) {
    const current = toVisit.shift()!
    if (visited.has(current.url)) continue
    if (current.depth > depth) continue

    visited.add(current.url)

    try {
      const cookieHeader = ctx.cookieJar.getCookieHeader(current.url)
      const response = await fetch(current.url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          Cookie: cookieHeader,
        },
        redirect: "follow",
        signal: AbortSignal.timeout(10000),
      })

      const contentType = response.headers.get("content-type") || ""
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) continue

      const html = await response.text()
      const $ = cheerio.load(html)

      const links = $("a[href]")
        .map((_, el) => $(el).attr("href"))
        .get()
        .filter(Boolean) as string[]

      for (const link of links) {
        try {
          const resolved = new URL(link, current.url)
          if (resolved.origin !== baseOrigin) continue

          const normalized = normalizeUrl(resolved.href)
          if (normalized && !discovered.has(normalized)) {
            discovered.add(normalized)
            if (current.depth + 1 <= depth && discovered.size < maxUrls) {
              toVisit.push({ url: normalized, depth: current.depth + 1 })
            }
          }
        } catch { }
      }
    } catch { }
  }

  const urls = Array.from(discovered).slice(0, maxUrls)
  return JSON.stringify({ urls, total_found: urls.length }, null, 2)
}

function normalizeUrl(url: string): string | null {
  try {
    const u = new URL(url)
    u.hash = ""
    let path = u.pathname
    if (path.endsWith("/") && path.length > 1) {
      path = path.slice(0, -1)
    }
    u.pathname = path
    return u.href
  } catch {
    return null
  }
}
