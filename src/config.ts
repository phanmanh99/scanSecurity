import type { ScanConfig } from "./types"

export function parseConfig(args: string[]): ScanConfig {
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

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    switch (arg) {
      case "--url":
        config.target_url = args[++i]!
        break
      case "--username":
        config.username = args[++i]!
        break
      case "--password":
        config.password = args[++i]!
        break
      case "--login-url":
        config.login_url = args[++i]!
        break
      case "--model":
        config.model = args[++i]!
        break
      case "--api":
        config.api_url = args[++i]!
        break
      case "--depth":
        config.max_depth = parseInt(args[++i]!)
        break
      case "--max-urls":
        config.max_urls = parseInt(args[++i]!)
        break
      case "--concurrency":
        config.concurrency = parseInt(args[++i]!)
        break
      case "--output":
        config.output_dir = args[++i]!
        break
      case "--max-iterations":
        config.max_iterations = parseInt(args[++i]!)
        break
      case "--help":
      case "-h":
        printHelp()
        process.exit(0)
    }
  }

  if (!config.target_url) {
    console.error("Error: --url is required")
    printHelp()
    process.exit(1)
  }

  return config
}

function printHelp() {
  console.log(`
scanSecurity - AI-powered web security scanner

Usage:
  bun run src/index.ts --url <target_url> [options]

Options:
  --url <url>              Target website URL (required)
  --username <user>        Login username
  --password <pass>        Login password
  --login-url <url>        Login page URL (default: auto-detect)
  --model <name>           AI model name (default: gpt-5.2)
  --api <url>              AI API endpoint (default: http://localhost:3000/v1/chat/completions)
  --depth <n>              Crawl depth (default: 2)
  --max-urls <n>           Max URLs to crawl (default: 500)
  --concurrency <n>        Concurrent requests (default: 5)
  --output <dir>           Output directory (default: ./output)
  --max-iterations <n>     Max AI iterations (default: 100)
  --help, -h               Show this help
`)
}
