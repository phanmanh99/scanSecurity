import { createInterface } from "readline"
import type { ScanConfig } from "./types"

function clearScreen() {
  process.stdout.write("\x1b[2J\x1b[H")
}

function color(text: string, code: string): string {
  const codes: Record<string, string> = {
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    dim: "\x1b[2m",
    bold: "\x1b[1m",
    reset: "\x1b[0m",
  }
  return `${codes[code] || ""}${text}${codes.reset}`
}

function logo() {
  console.log(color("  ╔══════════════════════════════════════════════╗", "cyan"))
  console.log(color("  ║       scanSecurity — AI Web Scanner         ║", "cyan"))
  console.log(color("  ║  Interactive Mode                           ║", "cyan"))
  console.log(color("  ╚══════════════════════════════════════════════╝", "cyan"))
  console.log("")
}

async function prompt(question: string, defaultValue = ""): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const defaultText = defaultValue ? ` [${color(defaultValue, "dim")}]` : ""
  return new Promise((resolve) => {
    rl.question(`  ${color("?", "yellow")} ${question}${defaultText}: `, (answer) => {
      rl.close()
      resolve(answer.trim() || defaultValue)
    })
  })
}

function urlFromPrompt(text: string): string | null {
  const patterns = [
    /https?:\/\/[^\s,]+/i,
    /(?:scan|check|test)\s+(https?:\/\/[^\s,]+)/i,
  ]
  for (const p of patterns) {
    const m = text.match(p)
    if (m) return m[1] || m[0]
  }
  return null
}

async function confirmPrompt(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(`  ${color("?", "yellow")} ${question} ${color("(y/n)", "dim")}: `, (answer) => {
      rl.close()
      resolve(answer.trim().toLowerCase().startsWith("y"))
    })
  })
}

function showConfig(config: ScanConfig) {
  console.log("")
  console.log(color("  ┌─ Scan Configuration ─────────────────────┐", "blue"))
  if (config.user_prompt) {
    const truncated = config.user_prompt.length > 60
      ? config.user_prompt.slice(0, 60) + "…"
      : config.user_prompt
    console.log(`  │ ${color("Prompt:", "bold")}            ${truncated}`)
  }
  console.log(`  │ ${color("Target URL:", "bold")}        ${config.target_url}`)
  console.log(`  │ ${color("Login URL:", "bold")}         ${config.login_url || "(auto-detect)"}`)
  console.log(`  │ ${color("Username:", "bold")}           ${config.username || "(none)"}`)
  console.log(`  │ ${color("Password:", "bold")}           ${config.password ? "••••••••" : "(none)"}`)
  console.log(`  │ ${color("Model:", "bold")}              ${config.model}`)
  console.log(`  │ ${color("API URL:", "bold")}            ${config.api_url}`)
  console.log(`  │ ${color("Crawl Depth:", "bold")}        ${config.max_depth}`)
  console.log(`  │ ${color("Max URLs:", "bold")}           ${config.max_urls}`)
  console.log(`  │ ${color("Concurrency:", "bold")}        ${config.concurrency}`)
  console.log(`  │ ${color("Output Dir:", "bold")}         ${config.output_dir}`)
  console.log(`  │ ${color("Max Iterations:", "bold")}     ${config.max_iterations}`)
  console.log(color("  └──────────────────────────────────────────┘", "blue"))
  console.log("")
}

async function askNumber(question: string, defaultValue: number): Promise<number> {
  const answer = await prompt(question, String(defaultValue))
  const num = parseInt(answer, 10)
  return isNaN(num) ? defaultValue : num
}

export async function runTUI(): Promise<ScanConfig | null> {
  clearScreen()
  logo()

  const config: ScanConfig = {
    target_url: "",
    model: "gpt-5.2",
    api_url: "http://localhost:3000/v1/chat/completions",
    max_depth: 2,
    max_urls: 500,
    concurrency: 5,
    output_dir: "./output",
    max_iterations: 100,
  }

  // Step 1: Natural language prompt
  console.log(color("  ── Step 1: What do you want to scan? ─────────", "magenta"))
  console.log(`  ${color("Describe the scan in natural language.", "dim")}`)
  console.log(`  ${color("Examples:", "dim")}`)
  console.log(`  ${color("  • \"Scan https://example.com for error pages\"", "dim")}`)
  console.log(`  ${color("  • \"Check security headers on https://site.com\"", "dim")}`)
  console.log(`  ${color("  • \"Find all 4xx and 5xx errors on https://app.example.com with login admin:pass123\"", "dim")}`)
  console.log("")

  const raw = await prompt("Your request")
  if (!raw) {
    console.log(`  ${color("✖", "red")} No request provided.`)
    return null
  }
  config.user_prompt = raw

  // Parse URL from prompt
  const foundUrl = urlFromPrompt(raw)
  if (foundUrl) {
    console.log(`  ${color("✓", "green")} Detected URL: ${foundUrl}`)
    config.target_url = foundUrl
  } else {
    console.log(`  ${color("!", "yellow")} No URL detected in request.`)
    config.target_url = await prompt("Enter target URL")
    if (!config.target_url) {
      console.log(`  ${color("✖", "red")} Target URL is required.`)
      return null
    }
  }
  console.log("")

  // Parse credentials from prompt (e.g. "login admin:pass123" or "with credentials user:pass")
  const credMatch = raw.match(/(?:login|credentials?)\s+(\S+):(\S+)/i)
  if (credMatch) {
    config.username = credMatch[1]
    config.password = credMatch[2]
    console.log(`  ${color("✓", "green")} Detected credentials: ${config.username}:${config.password?.replace(/./g, "•")}`)
  }
  console.log("")

  // Step 2: Authentication (optional)
  console.log(color("  ── Step 2: Authentication (optional) ────────", "magenta"))
  const needAuth = await confirmPrompt("Does the site require login?")
  if (needAuth) {
    if (!config.username) config.username = await prompt("Username")
    if (!config.password) {
      const pw = await prompt("Password")
      if (pw) config.password = pw
    }
    config.login_url = await prompt("Login page URL", config.login_url || "")
  }
  console.log("")

  // Step 3: Advanced settings
  const advancedMode = await confirmPrompt("Show advanced settings?")
  if (advancedMode) {
    console.log(color("  ── Step 3: Advanced Settings ────────────────", "magenta"))
    config.max_depth = await askNumber("Crawl depth", 2)
    config.max_urls = await askNumber("Max URLs to crawl", 500)
    config.concurrency = await askNumber("Concurrent requests", 5)
    config.max_iterations = await askNumber("Max AI iterations", 100)
    config.output_dir = await prompt("Output directory", "./output")
    config.model = await prompt("AI model", "gpt-5.2")
    config.api_url = await prompt("AI API endpoint", "http://localhost:3000/v1/chat/completions")
    console.log("")
  }

  // Summary
  clearScreen()
  logo()
  showConfig(config)

  const confirm = await confirmPrompt("Start scan?")
  if (!confirm) {
    console.log(`  ${color("✖", "red")} Scan cancelled.`)
    return null
  }

  return config
}
