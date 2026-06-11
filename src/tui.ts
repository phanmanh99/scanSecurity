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

async function showProgress(status: string, detail: string) {
  const timestamp = new Date().toLocaleTimeString()
  process.stdout.write(`\r\x1b[2K  ${color(timestamp, "dim")} ${color("▶", "green")} ${status} ${color(detail, "dim")}`)
}

async function askNumber(question: string, defaultValue: number): Promise<number> {
  const answer = await prompt(question, String(defaultValue))
  const num = parseInt(answer, 10)
  return isNaN(num) ? defaultValue : num
}

export async function runTUI(): Promise<ScanConfig | null> {
  clearScreen()
  logo()

  const advancedMode = await confirmPrompt("Show advanced settings?")

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

  // Step 1: Target URL
  console.log(color("  ── Step 1: Target ───────────────────────────", "magenta"))
  config.target_url = await prompt("Enter target URL")
  if (!config.target_url) {
    console.log(`  ${color("✖", "red")} Target URL is required.`)
    return null
  }
  console.log("")

  // Step 2: Authentication (optional)
  console.log(color("  ── Step 2: Authentication (optional) ────────", "magenta"))
  const needAuth = await confirmPrompt("Does the site require login?")
  if (needAuth) {
    config.login_url = await prompt("Login page URL (leave blank for auto-detect)")
    config.username = await prompt("Username")
    const pw = await prompt("Password")
    if (pw) config.password = pw
  }
  console.log("")

  // Step 3: Advanced settings
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
