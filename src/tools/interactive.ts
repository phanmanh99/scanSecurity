import type { ToolHandler } from "../types"
import { createInterface } from "readline"

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
    const $ = (await import("cheerio")).load(html)

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

    const formAction = new URL(forms[0]?.action || url, url).href

    return JSON.stringify({
      url,
      forms_found: forms.length,
      forms: forms.map(f => ({
        action: new URL(f.action, url).href,
        method: f.method,
        fields_count: f.fields.length,
        fields: f.fields,
        is_login_form: f.is_login,
      })),
      has_login_form: forms.some(f => f.is_login),
      login_form_action: forms.find(f => f.is_login) ? new URL(forms.find(f => f.is_login)!.action, url).href : null,
      suggestion: forms.some(f => f.is_login)
        ? `Login form detected at ${url}. Use ask_user() to ask which credentials to use, then call login().`
        : "No login form detected on this page.",
    }, null, 2)
  } catch (err: any) {
    return JSON.stringify({ url, error: `Failed to detect forms: ${err.message}`, forms_found: 0, forms: [] })
  }
}
