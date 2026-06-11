import type { CookieJar } from "./types"

export function createCookieJar(): CookieJar {
  const cookies = new Map<string, string>()

  function setCookie(url: string, cookieHeader: string) {
    const parsed = parseSetCookie(cookieHeader)
    for (const [key, value] of parsed) {
      cookies.set(key, value)
    }
  }

  function getCookieHeader(url: string): string {
    const parts: string[] = []
    for (const [key, value] of cookies) {
      parts.push(`${key}=${value}`)
    }
    return parts.join("; ")
  }

  function clear() {
    cookies.clear()
  }

  return { cookies, setCookie, getCookieHeader, clear }
}

function parseSetCookie(header: string): Map<string, string> {
  const result = new Map<string, string>()
  const pairs = header.split(";")
  for (const pair of pairs) {
    const trimmed = pair.trim()
    if (!trimmed) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.substring(0, eqIdx).trim()
    const value = trimmed.substring(eqIdx + 1).trim()
    if (["Domain", "Path", "Expires", "Max-Age", "Secure", "HttpOnly", "SameSite"].includes(key)) continue
    result.set(key, value)
  }
  return result
}
