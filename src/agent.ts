import type { ScanConfig, Message, ToolCall, ToolContext } from "./types"
import { callAI } from "./ai"
import { createCookieJar } from "./cookie-jar"
import { createRegistry } from "./tools/registry"
import { Reporter } from "./tools/reporter"

function buildSystemPrompt(config: ScanConfig): string {
  let prompt = `You are a web security scanning AI agent. Your task is to systematically scan a website to discover HTTP error pages (4xx, 5xx, and fake-200 error pages).

TARGET: ${config.target_url}

Your mission:
1. First, DISCOVER the host to find all entry points using discover() (checks robots.txt, sitemap, common paths)
2. DETECT FORMS using detect_forms() on the target to find login forms and input fields
3. If a login form is found and you need credentials, ASK the user using ask_user() with kind="credentials"
4. LOGIN with the provided credentials
5. CRAWL the website to discover more accessible URLs
6. TEST each URL with GET requests to check for errors
7. For forms and API endpoints, also try POST requests
8. ANALYZE each response to determine if it's an error page
9. CHECK_HEADERS on each response to find missing/insecure HTTP security headers
10. REPORT each finding using the report tool
11. When finished, provide a summary of all findings

STRATEGY:
- Step 1: ALWAYS call discover() first to find URLs and detect login forms
- Step 2: If login form found AND no credentials in config, call ask_user() to get credentials from the user
- Step 3: Call login() to authenticate
- Step 4: Then crawl() to discover all pages (use the discovered URLs)
- Use batch_request() to efficiently test multiple URLs at once
- For each response, call analyze() to check if it's an error
- For each response, call check_headers() with the headers to audit HTTP security
- If something looks suspicious (forms, API endpoints, unusual URLs), try POST with generated payloads
- Report every error and header issue you find

IMPORTANT - Error Classification Rules (MUST FOLLOW):
- When analyze() returns error_type like "404", "403", "500", "503" — use that EXACT value when calling report()
- Do NOT change error_type based on page content. A 404 page mentioning "error" or "exception" is still a 404.
- 4xx = client errors (bad request, not found, forbidden). 5xx = server errors (internal error, unavailable).
- These are different categories. Never report a 4xx as 5xx or vice versa.
- Use analyze() result's error_type as the SOURCE OF TRUTH for error classification.

IMPORTANT: When you detect a login form but don't have credentials in config, you MUST ask the user FIRST using ask_user() with kind="credentials" before attempting login.

INTERACTIVE WITH USER:
- Use ask_user() when you need information
- For login: ask_user({ question: "Which account to use for login?", kind: "credentials" })
- For confirmations: ask_user({ question: "...?", kind: "confirm" })
- For choices: ask_user({ question: "...?", kind: "choice", options: [...] })
- The user will type their response in the terminal

RULES:
- Stay on the same domain (${new URL(config.target_url).origin})
- IMPORTANT: When testing POST requests, use generate_payload() first to create test payloads
- Be thorough but efficient - check all discovered URLs
- When calling request() or batch_request(), the system automatically handles cookies
- Do NOT call the same tool with identical parameters twice
- When you have tested all URLs and reported all findings, say "SCAN_COMPLETE" followed by a summary
`

  if (config.username) {
    prompt += `\nLOGIN CREDENTIALS (from config):\n- Username: ${config.username}\n- Password: ${config.password}\n`
    if (config.login_url) {
      prompt += `- Login URL: ${config.login_url}\n`
    }
  } else {
    prompt += `\nNOTE: No login credentials in config. If discover() finds a login form, you MUST use ask_user() to get credentials from the user before proceeding.\n`
  }

  return prompt
}

export async function runAgent(config: ScanConfig) {
  console.log("\n" + "=".repeat(70))
  console.log("  scanSecurity - AI-Powered Web Security Scanner")
  console.log("=".repeat(70))
  console.log(`  Target: ${config.target_url}`)
  console.log(`  Model:  ${config.model}`)
  console.log(`  API:    ${config.api_url}`)
  console.log("=".repeat(70) + "\n")

  const cookieJar = createCookieJar()
  const reporter = new Reporter(config.output_dir)
  const registry = createRegistry(reporter)

  const systemMsg: Message = { role: "system", content: buildSystemPrompt(config) }
  const hasConfigCredentials = !!(config.username && config.password)
  const authInstruction = hasConfigCredentials
    ? "credentials are in config"
    : "NO credentials in config -- use ask_user() to get them from the user"
  const credsNote = hasConfigCredentials
    ? "Credentials are configured: username=" + config.username + ". After discover(), proceed with login."
    : "No credentials configured. If discover() finds a login form, use ask_user() to ask the user for credentials before proceeding."

  const userMsg: Message = {
    role: "user",
    content: "Start scanning " + config.target_url + " for error pages and security header issues.\n\n"
      + "Step-by-step:\n"
      + "1. First, call discover() to find all URLs, entry points, and detect if there's a login form\n"
      + "2. If a login form exists and " + authInstruction + ", then login\n"
      + "3. After login, crawl and systematically test every URL for:\n"
      + "   - 4xx errors, 5xx errors\n"
      + "   - Fake-200 error pages (200 status but error content)\n"
      + "   - HTTP security header issues (use check_headers())\n"
      + "4. Report everything you find\n\n"
      + credsNote,
  }

  const messages: Message[] = [systemMsg, userMsg]

  let iteration = 0
  const maxIterations = config.max_iterations

  while (iteration < maxIterations) {
    iteration++
    console.log(`\n\x1b[34m[Iteration ${iteration}/${maxIterations}]\x1b[0m Calling AI...`)

    let response
    try {
      response = await callAI(config.api_url, config.model, messages, registry.definitions)
    } catch (err: any) {
      console.error(`\x1b[31m[ERROR]\x1b[0m AI call failed: ${err.message}`)
      break
    }

    const choice = response.choices[0]
    if (!choice) {
      console.error("\x1b[31m[ERROR]\x1b[0m No response from AI")
      break
    }

    const msg = choice.message
    const content = msg.content || ""
    const toolCalls = msg.tool_calls

    if (content) {
      console.log(`\n\x1b[32m[AI]\x1b[0m ${content}`)

      if (content.includes("SCAN_COMPLETE")) {
        console.log("\n\x1b[32m✓ Scan complete signal received\x1b[0m")
        break
      }
    }

    if (toolCalls && toolCalls.length > 0) {
      const assistantMsg: Message = {
        role: "assistant",
        content: content || null,
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      }
      messages.push(assistantMsg)

      for (const tc of toolCalls) {
        let args: Record<string, unknown> = {}
        try {
          args = JSON.parse(tc.function.arguments)
        } catch {
          args = { raw: tc.function.arguments }
        }

        console.log(`\n  \x1b[33m[TOOL]\x1b[0m ${tc.function.name}(${JSON.stringify(args).substring(0, 200)}...)`)

        const ctx: ToolContext = {
          config,
          cookieJar,
          reporter,
          addSystemMessage: (msg: string) => {
            messages.push({ role: "system", content: msg })
          },
        }

        const result = await registry.execute(tc.function.name, args, ctx)

        const resultPreview = result.length > 500 ? result.substring(0, 500) + "\n...[TRUNCATED]" : result
        console.log(`  \x1b[90m[RESULT]\x1b[0m ${resultPreview}`)

        messages.push({
          role: "tool",
          content: result,
          tool_call_id: tc.id,
        })
      }
    } else {
      const assistantMsg: Message = {
        role: "assistant",
        content: content || null,
      }
      messages.push(assistantMsg)

      if (!content && !toolCalls) {
        console.log("\x1b[33m[WARN]\x1b[0m AI returned empty response with no tool calls")
        break
      }

      if (content && !content.includes("SCAN_COMPLETE")) {
        continue
      }
    }

    if (iteration >= maxIterations) {
      console.log(`\n\x1b[33m[WARN]\x1b[0m Reached max iterations (${maxIterations})`)
    }
  }

  console.log("\n" + "=".repeat(70))
  console.log("  SCAN COMPLETE")
  console.log("=".repeat(70))

  await reporter.exportAll()

  const allFindings = reporter.getAll()
  const error4xx = allFindings.filter(f => f.status_code >= 400 && f.status_code < 500)
  const error5xx = allFindings.filter(f => f.status_code >= 500 && f.status_code < 600)
  const fake200 = allFindings.filter(f => f.error_type.startsWith("fake_200"))
  const headerIssues = allFindings.filter(f => f.error_type.startsWith("header_"))

  console.log(`\n  Summary:`)
  console.log(`  - Total findings:     ${allFindings.length}`)
  console.log(`  - 4xx errors:         ${error4xx.length}`)
  console.log(`  - 5xx errors:         ${error5xx.length}`)
  console.log(`  - Fake-200 errors:    ${fake200.length}`)
  console.log(`  - Header issues:      ${headerIssues.length}`)
  console.log("")
}
