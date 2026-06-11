import * as cheerio from "cheerio"
import type { ToolHandler, LoginResult } from "../types"

export const loginTool: ToolHandler = async (args, ctx) => {
  const loginUrl = (args.login_url as string) || ctx.config.login_url || ctx.config.target_url
  const username = (args.username as string) || ctx.config.username || ""
  const password = (args.password as string) || ctx.config.password || ""

  if (!username || !password) {
    return JSON.stringify({ success: false, message: "Username and password are required" })
  }

  try {
    const loginPageResp = await fetch(loginUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    })

    const html = await loginPageResp.text()
    const setCookie = loginPageResp.headers.get("set-cookie")
    if (setCookie) {
      ctx.cookieJar.setCookie(loginUrl, setCookie)
    }

    const $ = cheerio.load(html)
    const form = $("form").first()
    const action = form.attr("action") || loginUrl
    const method = (form.attr("method") || "POST").toUpperCase()

    const formAction = action.startsWith("http") ? action : new URL(action, loginUrl).href

    const fields: Record<string, string> = {}
    let usernameField = "username"
    let passwordField = "password"

    form.find("input").each((_, el) => {
      const name = $(el).attr("name")
      const type = $(el).attr("type") || "text"
      const value = $(el).attr("value") || ""
      if (!name) return

      if (type === "hidden" || type === "submit") {
        fields[name] = value
      } else if (type === "text" || type === "email") {
        fields[name] = username
        usernameField = name
      } else if (type === "password") {
        fields[name] = password
        passwordField = name
      }
    })

    if (!fields[usernameField]) fields[usernameField] = username
    if (!fields[passwordField]) fields[passwordField] = password

    const cookieHeader = ctx.cookieJar.getCookieHeader(loginUrl)
    const loginResp = await fetch(formAction, {
      method,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieHeader,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
      body: new URLSearchParams(fields).toString(),
      redirect: "follow",
    })

    const respSetCookie = loginResp.headers.get("set-cookie")
    if (respSetCookie) {
      ctx.cookieJar.setCookie(formAction, respSetCookie)
    }

    const finalUrl = loginResp.url
    const loginHtml = await loginResp.text()

    const isLoggedIn = detectLoggedIn(loginHtml, finalUrl, loginUrl)

    const result: LoginResult = {
      success: isLoggedIn,
      message: isLoggedIn
        ? `Login successful. Redirected to: ${finalUrl}`
        : `Login may have failed. Final URL: ${finalUrl}. Status: ${loginResp.status}`,
    }

    if (isLoggedIn) {
      const allCookies = ctx.cookieJar.getCookieHeader(finalUrl)
      result.cookies = Object.fromEntries(
        allCookies.split("; ").filter(Boolean).map(c => {
          const [k, ...v] = c.split("=")
          return [k!, v.join("=")]
        }),
      )
    }

    return JSON.stringify(result, null, 2)
  } catch (err: any) {
    return JSON.stringify({
      success: false,
      message: `Login error: ${err?.message || String(err)}`,
    })
  }
}

function detectLoggedIn(html: string, finalUrl: string, loginUrl: string): boolean {
  if (finalUrl !== loginUrl && !finalUrl.includes("/login") && !finalUrl.includes("/signin") && !finalUrl.includes("/auth")) {
    return true
  }

  const noLoginIndicators = [
    "logout", "sign out", "welcome", "dashboard", "my account",
    "profile", "hello,", "hi,",
  ]
  const htmlLower = html.toLowerCase()
  for (const indicator of noLoginIndicators) {
    if (htmlLower.includes(indicator)) return true
  }

  const loginIndicators = ["login", "sign in", "password", "invalid credentials", "incorrect"]
  const stillHasLogin = loginIndicators.some(i => htmlLower.includes(i))
  if (!stillHasLogin) return true

  return false
}
