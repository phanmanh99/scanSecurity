import * as cheerio from "cheerio"
import type { ToolHandler } from "../types"

const COMMON_PATHS = [
  "/admin", "/login", "/signin", "/auth", "/register", "/signup",
  "/api", "/api/v1", "/api/v2", "/graphql", "/swagger", "/docs",
  "/wp-admin", "/administrator", "/manager", "/panel", "/cpanel",
  "/backup", "/config", "/config.php", "/env", "/.env",
  "/test", "/debug", "/dev", "/phpinfo.php",
  "/.git", "/.git/config", "/.svn",
  "/robots.txt", "/sitemap.xml", "/sitemap_index.xml",
  "/crossdomain.xml", "/security.txt",
  "/assets", "/static", "/uploads", "/files", "/download",
  "/search", "/contact", "/about", "/terms", "/privacy",
  "/user", "/users", "/profile", "/account", "/dashboard",
  "/logout", "/forgot-password", "/reset-password",
  "/api/health", "/api/status", "/api/users", "/api/config",
  "/.well-known/security.txt", "/.well-known/assetlinks.json",
]

const COMMON_API_PATHS = [
  "/api/login", "/api/auth", "/api/token", "/api/refresh",
  "/api/user", "/api/users", "/api/admin",
  "/api/upload", "/api/config", "/api/settings",
  "/graphql", "/api/graphql",
  "/swagger-resources", "/v2/api-docs", "/v3/api-docs",
]

async function checkUrl(url: string, cookieHeader: string): Promise<{ status: number; exists: boolean }> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Cookie: cookieHeader,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    })
    return { status: response.status, exists: response.status < 400 || (response.status >= 400 && response.status < 500) }
  } catch {
    return { status: 0, exists: false }
  }
}

async function parseRobotsTxt(url: string, cookieHeader: string): Promise<{ disallowed: string[]; sitemaps: string[]; content: string }> {
  const result = { disallowed: [] as string[], sitemaps: [] as string[], content: "" }
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Cookie: cookieHeader },
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return result
    const text = await response.text()
    result.content = text.substring(0, 2000)
    for (const line of text.split("\n")) {
      const trimmed = line.trim()
      if (trimmed.toLowerCase().startsWith("disallow:")) {
        const path = trimmed.substring(9).trim()
        if (path) result.disallowed.push(path)
      }
      if (trimmed.toLowerCase().startsWith("sitemap:")) {
        const sitemap = trimmed.substring(8).trim()
        if (sitemap) result.sitemaps.push(sitemap)
      }
    }
  } catch {}
  return result
}

async function parseSitemap(url: string, cookieHeader: string): Promise<string[]> {
  const urls: string[] = []
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Cookie: cookieHeader },
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) return urls
    const text = await response.text()
    const locs = text.match(/<loc[^>]*>([^<]+)<\/loc>/gi) || []
    for (const loc of locs) {
      const match = loc.match(/<loc[^>]*>([^<]+)<\/loc>/i)
      if (match?.[1]) urls.push(match[1].trim())
    }
  } catch {}
  return urls
}

export const discoverTool: ToolHandler = async (args, ctx) => {
  const hostUrl = (args.url as string) || ctx.config.target_url
  if (!hostUrl) return "Error: url is required"

  const baseUrl = new URL(hostUrl)
  const baseOrigin = baseUrl.origin
  const cookieHeader = ctx.cookieJar.getCookieHeader(hostUrl)

  const discovered = new Set<string>()
  const results: Record<string, any> = {}

  results.robots_txt = await parseRobotsTxt(`${baseOrigin}/robots.txt`, cookieHeader)
  if (results.robots_txt.content) {
    for (const path of results.robots_txt.disallowed) {
      try { discovered.add(new URL(path, baseOrigin).href) } catch {}
    }
  }

  const sitemapResults: string[] = []
  const sitemapsToCheck = results.robots_txt.sitemaps.length > 0
    ? results.robots_txt.sitemaps
    : [`${baseOrigin}/sitemap.xml`]

  for (const smUrl of sitemapsToCheck) {
    const smUrls = await parseSitemap(smUrl, cookieHeader)
    sitemapResults.push(...smUrls)
    for (const u of smUrls) discovered.add(u)
  }
  results.sitemap = { checked: sitemapsToCheck, urls_found: sitemapResults.length }

  const commonResults: { path: string; status: number }[] = []
  const allPaths = [...new Set([...COMMON_PATHS, ...COMMON_API_PATHS])]

  const batchSize = 10
  for (let i = 0; i < allPaths.length; i += batchSize) {
    const batch = allPaths.slice(i, i + batchSize)
    const checks = await Promise.all(
      batch.map(async (path) => {
        const url = new URL(path, baseOrigin).href
        const { status, exists } = await checkUrl(url, cookieHeader)
        return { path, url, status, exists }
      }),
    )
    for (const c of checks) {
      if (c.exists) {
        discovered.add(c.url)
        commonResults.push({ path: c.path, status: c.status })
      }
    }
  }
  results.common_paths = { checked: allPaths.length, found: commonResults.length, items: commonResults.slice(0, 50) }

  const homeLinks: string[] = []
  try {
    const homeResp = await fetch(hostUrl, {
      headers: { "User-Agent": "Mozilla/5.0", Cookie: cookieHeader },
      signal: AbortSignal.timeout(10000),
    })
    const html = await homeResp.text()
    const $ = cheerio.load(html)
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href")
      if (!href) return
      try {
        const resolved = new URL(href, hostUrl)
        if (resolved.origin === baseOrigin) {
          resolved.hash = ""
          let path = resolved.pathname
          if (path.endsWith("/") && path.length > 1) path = path.slice(0, -1)
          resolved.pathname = path
          homeLinks.push(resolved.href)
        }
      } catch {}
    })
  } catch {}
  for (const u of homeLinks) discovered.add(u)
  results.homepage_links = { found: homeLinks.length }

  const loginFormDetected = detectLoginForm(results, homeLinks, commonResults)

  const allUrls = Array.from(discovered).slice(0, ctx.config.max_urls)

  return JSON.stringify({
    base_url: baseOrigin,
    urls_discovered: allUrls.length,
    has_login_form: loginFormDetected,
    sources: {
      robots_txt: {
        exists: !!results.robots_txt.content,
        disallowed_paths: results.robots_txt.disallowed.length,
        sitemaps: results.robots_txt.sitemaps,
      },
      sitemap: sitemapResults.length > 0 ? `${sitemapResults.length} URLs found` : "not found",
      common_paths: `${results.common_paths.found} found out of ${results.common_paths.checked} checked`,
      homepage_links: `${results.homepage_links.found} links found`,
    },
    login_urls: loginFormDetected ? findLoginUrls(allUrls, commonResults) : [],
    urls: allUrls,
  }, null, 2)
}

function detectLoginForm(results: any, homeLinks: string[], commonResults: { path: string; status: number }[]): boolean {
  const loginPaths = ["/login", "/signin", "/auth", "/admin", "/account"]
  for (const cr of commonResults) {
    if (loginPaths.some(p => cr.path.startsWith(p)) && cr.status < 400) return true
  }
  for (const link of homeLinks) {
    const lower = link.toLowerCase()
    if (loginPaths.some(p => lower.includes(p))) return true
  }
  if (results.robots_txt.disallowed.some((d: string) => loginPaths.some(p => d.includes(p)))) return true
  return false
}

function findLoginUrls(allUrls: string[], commonResults: { path: string; status: number }[]): string[] {
  const loginUrls: string[] = []
  const loginPaths = ["/login", "/signin", "/auth", "/admin", "/account"]
  for (const u of allUrls) {
    const lower = u.toLowerCase()
    if (loginPaths.some(p => lower.includes(p))) loginUrls.push(u)
  }
  return loginUrls
}
