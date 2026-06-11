import type { Finding } from "../types"

export class Reporter {
  private findings: Finding[] = []
  private outputDir: string

  constructor(outputDir: string) {
    this.outputDir = outputDir
  }

  add(finding: Finding) {
    this.findings.push(finding)
  }

  getAll(): Finding[] {
    return [...this.findings]
  }

  printSummary() {
    const error4xx = this.findings.filter(f => f.status_code >= 400 && f.status_code < 500)
    const error5xx = this.findings.filter(f => f.status_code >= 500 && f.status_code < 600)
    const fake200 = this.findings.filter(f => f.error_type.startsWith("fake_200"))
    const total = this.findings.length

    console.log("\n" + "=".repeat(70))
    console.log("  SCAN RESULTS SUMMARY")
    console.log("=".repeat(70))
    console.log(`  Total findings: ${total}`)
    console.log(`  4xx errors:     ${error4xx.length}`)
    console.log(`  5xx errors:     ${error5xx.length}`)
    console.log(`  Fake-200 errors: ${fake200.length}`)
    console.log("-".repeat(70))

    if (this.findings.length === 0) {
      console.log("  No errors found.")
      return
    }

    console.log("\n  URL".padEnd(50) + "STATUS".padEnd(10) + "METHOD".padEnd(10) + "CONFIDENCE")
    console.log("-".repeat(80))
    for (const f of this.findings) {
      const url = f.url.length > 47 ? f.url.substring(0, 44) + "..." : f.url
      const color = f.status_code >= 500 ? "\x1b[31m" : f.status_code >= 400 ? "\x1b[33m" : "\x1b[36m"
      const reset = "\x1b[0m"
      console.log(
        `  ${color}${url.padEnd(50)}${String(f.status_code).padEnd(10)}${f.method.padEnd(10)}${(f.confidence * 100).toFixed(0)}%${reset}`,
      )
    }
    console.log("-".repeat(80))
  }

  async exportJSON(): Promise<string> {
    const path = `${this.outputDir}/findings.json`
    const content = JSON.stringify({
      scan_time: new Date().toISOString(),
      total_findings: this.findings.length,
      findings: this.findings,
    }, null, 2)
    await Bun.write(path, content)
    return path
  }

  async exportCSV(): Promise<string> {
    const path = `${this.outputDir}/findings.csv`
    const header = "url,status_code,method,error_type,confidence,details,timestamp\n"
    const rows = this.findings.map(f =>
      `"${f.url}",${f.status_code},"${f.method}","${f.error_type}",${f.confidence},"${f.details.replace(/"/g, '""')}","${f.timestamp}"`,
    ).join("\n")
    await Bun.write(path, header + rows)
    return path
  }

  async exportAll() {
    const jsonPath = await this.exportJSON()
    const csvPath = await this.exportCSV()
    this.printSummary()
    console.log(`\n  JSON: ${jsonPath}`)
    console.log(`  CSV:  ${csvPath}`)
    console.log("=".repeat(70) + "\n")
  }
}

export const reportTool = (reporter: Reporter): import("../types").ToolHandler => {
  return async (args) => {
    const url = args.url as string
    const statusCode = (args.status_code as number) || 0
    const method = (args.method as string) || "GET"
    const errorType = (args.error_type as string) || "unknown"
    const details = (args.details as string) || ""
    const confidence = (args.confidence as number) || 0.5

    if (!url) return "Error: url is required"

    const finding: Finding = {
      url,
      status_code: statusCode,
      method,
      error_type: errorType,
      confidence,
      details,
      timestamp: new Date().toISOString(),
    }

    reporter.add(finding)

    const color = statusCode >= 500 ? "\x1b[31m" : statusCode >= 400 ? "\x1b[33m" : "\x1b[36m"
    const reset = "\x1b[0m"
    console.log(`  ${color}[FOUND]${reset} ${method} ${url} → ${statusCode} (${errorType}, ${(confidence * 100).toFixed(0)}%)`)

    return JSON.stringify({ recorded: true, total_findings: reporter.getAll().length }, null, 2)
  }
}
