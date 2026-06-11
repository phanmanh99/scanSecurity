#!/usr/bin/env bun
import { parseConfig } from "./config"
import { runAgent } from "./agent"

const args = process.argv.slice(2)

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  const { parseConfig } = await import("./config")
  parseConfig(["--help"])
  process.exit(0)
}

const config = parseConfig(args)

try {
  await runAgent(config)
} catch (err: any) {
  console.error(`\x1b[31mFatal error:\x1b[0m ${err?.message || String(err)}`)
  process.exit(1)
}
