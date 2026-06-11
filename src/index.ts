#!/usr/bin/env bun
import { parseConfig } from "./config"
import { runAgent } from "./agent"
import { runTUI } from "./tui"

const args = process.argv.slice(2)

const hasUrlArg = args.some(a => a === "--url" || a === "-u")
const showHelp = args.includes("--help") || args.includes("-h")

if (showHelp) {
  const { parseConfig } = await import("./config")
  parseConfig(["--help"])
  process.exit(0)
}

let config

if (!hasUrlArg && args.length === 0) {
  config = await runTUI()
  if (!config) process.exit(0)
} else {
  config = parseConfig(args)
}

try {
  await runAgent(config)
} catch (err: any) {
  console.error(`\x1b[31mFatal error:\x1b[0m ${err?.message || String(err)}`)
  process.exit(1)
}
