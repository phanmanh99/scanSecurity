import type { ToolHandler } from "../types"
import { createInterface } from "readline"

const OAUTH_PATTERNS = [
  /google/i, /facebook/i, /github/i, /twitter/i, /x\.com/i,
  /microsoft/i, /linkedin/i, /apple/i, /sso/i, /oauth/i,
  /saml/i, /openid/i, /oidc/i, /azure/i, /auth0/i,
  /log in with/i, /sign in with/i, /continue with/i,
  /login.*google/i, /login.*facebook/i,
]

function detectAuthType($: cheerio.CheerioAPI, html: string): {
  type: "form" | "oauth" | "magic_link" | "token" | "none" | "unknown"
  description: string
} {
  const htmlLower = html.toLowerCase()
  const hasPasswordField = $('input[type="password"]').length > 0
  const hasEmailField = $('input[type="email"]').length > 0 || $('input[name="email"]').length > 0
  const hasUsernameField = $('input[name="username"]').length > 0 || $('input[name="user"]').length > 0 || $('input[name="login"]').length > 0
  const hasTokenField = $('input[name="token"]').length > 0 || $('input[name="api_key"]').length > 0 || $('input[name="apikey"]').length > 0
  const submitBtnText = $('input[type="submit"], button[type="submit"]').text().toLowerCase()

  const oauthLinks = $('a, button').filter((_, el) => {
    const text = $(el).text().toLowerCase()
    const href = ($(el).attr("href") || "").toLowerCase()
    const cls = ($(el).attr("class") || "").toLowerCase()
    const combined = text + " " + href + " " + cls
    return OAUTH_PATTERNS.some(p => p.test(combined))
  })

  if (hasPasswordField && (hasEmailField || hasUsernameField)) {
    return { type: "form", description: "Standard login form with username/email + password" }
  }

  if (oauthLinks.length > 0) {
    const providers = oauthLinks.map((_, el) => {
      const text = $(el).text().trim()
      const match = OAUTH_PATTERNS.find(p => p.test(text) || p.test($(el).attr("href") || ""))
      return match ? match.source.replace(/\\/g, "").replace(/\/i$/g, "") : "unknown"
    }).get()
    const uniqueProviders = [...new Set(providers)].filter(p => p !== "unknown")
    const providerList = uniqueProviders.length > 0
      ? ` (${uniqueProviders.slice(0, 4).join(", ")}${uniqueProviders.length > 4 ? "+more" : ""})`
      : ""

    return { type: "oauth", description: `OAuth/SSO login${providerList} — requires browser interaction. Cannot automate form login.` }
  }

  if (hasEmailField && !hasPasswordField && submitBtnText.includes("magic") || submitBtnText.includes("send") || submitBtnText.includes("link")) {
    return { type: "magic_link", description: "Magic link login (email only). Server sends a link to the email. Cannot automate." }
  }

  if (hasEmailField && !hasPasswordField) {
    return { type: "magic_link", description: "Email-only login form detected (no password field). Possibly magic link or one-time code." }
  }

  if (hasTokenField) {
    return { type: "token", description: "Token/API key login form detected. Use ask_user() to get the token from user." }
  }

  const forms = $("form")
  if (forms.length > 0) {
    return { type: "unknown", description: `Found ${forms.length} form(s) but no standard login fields detected. Use ask_user() to ask user how to authenticate.` }
  }

  return { type: "none", description: "No login form or authentication detected on this page. The site may be public or use header/certificate auth." }
}

export const askUserTool: ToolHandler = async (args) => {
  const question = (args.question as string) || "Please provide an answer:"
  const kind = (args.kind as string) || "text"

  console.log("")
  console.log("\x1b[35m" + "=".repeat(60) + "\x1b[0m")
  console.log("\x1b[35m  [INTERACTIVE] AI needs your input\x1b[0m")
  console.log("\x1b[35m" + "=".repeat(60) + "\x1b[0m")
  console.log(`\x1b[33m  ?\x1b[0m ${question}`)

  if (kind === "confirm") {
    console.log("  (\x1b[32myes\x1b[0m/\x1b[31mno\x1b[0m)")
  } else if (kind === "choice" && args.options) {
    const options = args.options as string[]
    options.forEach((opt, i) => console.log(`    ${i + 1}. ${opt}`))
  } else if (kind === "credentials") {
    console.log("  (Enter in format: \x1b[36musername:password\x1b[0m)")
  } else if (kind === "token") {
    console.log("  (Enter your \x1b[36mAPI token / bearer token\x1b[0m)")
  } else if (kind === "cookie") {
    console.log("  (Paste the \x1b[36mcookie string\x1b[0m from browser DevTools → Application → Cookies)")
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const answer = await new Promise<string>((resolve) => {
    rl.question("  \x1b[36m> \x1b[0m", (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })

  console.log("\x1b[35m" + "=".repeat(60) + "\x1b[0m\n")

  if (!answer) {
    return JSON.stringify({ answer: "", skipped: true, message: "User did not provide an answer" })
  }

  if (kind === "credentials" && answer.includes(":")) {
    const [u, ...p] = answer.split(":")
    return JSON.stringify({ answer, username: u, password: p.join(":"), skipped: false }, null, 2)
  }

  if (kind === "token") {
    return JSON.stringify({ answer, token: answer, skipped: false }, null, 2)
  }

  return JSON.stringify({ answer, skipped: false, message: `User response: ${answer}` }, null, 2)
}

export const detectFormsTool: ToolHandler = async (args, ctx) => {
  const url = (args.url as string) || ctx.config.target_url
  if (!url) return "Error: url is required"

  const cookieHeader = ctx.cookieJar.getCookieHeader(url)

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Cookie: cookieHeader },
      signal: AbortSignal.timeout(10000),
    })
    const html = await response.text()
    const { load } = await import("cheerio")
    const $ = load(html)

    const authInfo = detectAuthType($, html)

    const forms: { action: string; method: string; fields: { name: string; type: string; label: string }[]; is_login: boolean }[] = []

    $("form").each((_, formEl) => {
      const form = $(formEl)
      const action = form.attr("action") || url
      const method = (form.attr("method") || "GET").toUpperCase()
      const fields: { name: string; type: string; label: string }[] = []

      form.find("input, select, textarea").each((__, inputEl) => {
        const el = $(inputEl)
        const name = el.attr("name")
        if (!name) return
        const type = el.attr("type") || "text"
        const id = el.attr("id") || ""
        const label = form.find(`label[for="${id}"]`).text().trim() || el.attr("placeholder") || name
        fields.push({ name, type, label })
      })

      const fieldNames = fields.map(f => f.name.toLowerCase() + ":" + f.type)
      const fieldStr = fieldNames.join(", ")
      const is_login = /password/i.test(fieldStr) || /pass/i.test(fieldStr) ||
        (/user/i.test(fieldStr) && /pass/i.test(fieldStr))

      forms.push({ action, method, fields, is_login })
    })

    let suggestions: string[] = []
    if (authInfo.type === "form") {
      suggestions.push("Login form with username/password found. Use ask_user() to get credentials, then call login().")
    } else if (authInfo.type === "oauth") {
      suggestions.push("OAuth/SSO login detected. Cannot automate browser-based auth. Ask user if they can provide a session cookie instead.")
    } else if (authInfo.type === "magic_link") {
      suggestions.push("Magic link / email-only login. Cannot automate. Ask user how they want to proceed.")
    } else if (authInfo.type === "token") {
      suggestions.push("Token/API key login. Use ask_user() with kind='token' to get the token, then send it as a header.")
    } else if (authInfo.type === "none") {
      suggestions.push("No auth detected. Proceed with public/anonymous scanning.")
    } else {
      suggestions.push("Unknown auth type. Use ask_user() to ask the user how to authenticate.")
    }

    return JSON.stringify({
      url,
      auth_type: authInfo.type,
      auth_description: authInfo.description,
      forms_found: forms.length,
      forms: forms.map(f => ({
        action: new URL(f.action, url).href,
        method: f.method,
        fields_count: f.fields.length,
        fields: f.fields,
        is_login_form: f.is_login,
      })),
      has_login_form: authInfo.type === "form",
      has_oauth: authInfo.type === "oauth",
      has_magic_link: authInfo.type === "magic_link",
      login_form_action: forms.find(f => f.is_login) ? new URL(forms.find(f => f.is_login)!.action, url).href : null,
      suggestions,
    }, null, 2)
  } catch (err: any) {
    return JSON.stringify({ url, error: `Failed to detect forms: ${err.message}`, forms_found: 0, forms: [] })
  }
}
