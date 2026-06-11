import type { ToolHandler } from "../types"

const PAYLOADS: Record<string, Record<string, string[]>> = {
  empty: {
    "text": [""],
    "email": [""],
    "password": [""],
    "number": ["", "NaN", "-1", "0"],
  },
  invalid_type: {
    "text": ["<script>alert(1)</script>", "../../../etc/passwd", "%00", "NULL"],
    "email": ["not-an-email", "<script>alert(1)</script>@x", "a@b", "a".repeat(100) + "@b.com"],
    "password": ["' OR '1'='1", "admin'--", "'"],
    "number": ["abc", "1e999", "-999999999999999"],
    "select": ["-1", "999999", "' OR '1'='1"],
    "file": ["/etc/passwd", "../../../etc/passwd"],
  },
  xss: {
    "text": [
      "<script>alert(1)</script>",
      "<img src=x onerror=alert(1)>",
      "javascript:alert(1)",
      "\"><script>alert(1)</script>",
      "<svg onload=alert(1)>",
    ],
    "email": ["test@x.com\"><script>alert(1)</script>"],
    "textarea": ["<script>alert(1)</script>"],
  },
  sqli: {
    "text": [
      "' OR '1'='1",
      "' OR '1'='1' --",
      "admin'--",
      "1' OR '1'='1",
      "1 UNION SELECT 1,2,3--",
      "' UNION SELECT null,null,null--",
    ],
    "email": ["' OR '1'='1'@x.com"],
    "password": ["' OR '1'='1"],
  },
  overflow: {
    "text": ["A".repeat(1000), "A".repeat(10000), "%00".repeat(100)],
    "textarea": ["A".repeat(10000)],
  },
}

export const generatePayloadTool: ToolHandler = async (args) => {
  const formFieldsStr = (args.form_fields as string) || ""
  const strategy = (args.strategy as string) || "invalid_type"

  const fieldTypes = parseFormFields(formFieldsStr)
  const payloads = generatePayloads(fieldTypes, strategy)

  return JSON.stringify({
    strategy,
    field_types: fieldTypes,
    generated_payloads: payloads,
    count: payloads.length,
    note: "Use these payloads with the request tool (method: POST) to test for errors",
  }, null, 2)
}

function parseFormFields(input: string): Record<string, string> {
  const fields: Record<string, string> = {}

  const lines = input.split("\n").filter(Boolean)
  for (const line of lines) {
    const parts = line.split(":").map(s => s.trim())
    if (parts.length >= 2) {
      const name = parts[0]!.toLowerCase()
      const type = parts[1]!.toLowerCase()
      fields[name] = type
    }
  }

  const commonFields: Record<string, string> = {
    "username": "text",
    "email": "email",
    "password": "password",
    "search": "text",
    "q": "text",
    "comment": "textarea",
    "message": "textarea",
    "name": "text",
  }

  if (Object.keys(fields).length === 0) {
    Object.assign(fields, commonFields)
  }

  return fields
}

function generatePayloads(fields: Record<string, string>, strategy: string): Record<string, string>[] {
  const strategyPayloads = PAYLOADS[strategy]
  if (!strategyPayloads) return [fields]

  const results: Record<string, string>[] = []

  for (const [fieldName, fieldType] of Object.entries(fields)) {
    const pList = strategyPayloads[fieldType]
    if (!pList) continue

    for (const payload of pList) {
      const entry: Record<string, string> = {}
      for (const [fn, ft] of Object.entries(fields)) {
        entry[fn] = fn === fieldName ? payload : (ft === "password" ? "test123" : (fn === "username" || fn === "email" ? "test" : "test"))
      }
      results.push(entry)
    }
  }

  if (results.length === 0) {
    const entry: Record<string, string> = {}
    for (const fn of Object.keys(fields)) {
      entry[fn] = strategy === "empty" ? "" : "test"
    }
    results.push(entry)

    if (strategy === "xss") {
      entry[Object.keys(fields)[0]!] = "<script>alert(1)</script>"
    } else if (strategy === "sqli") {
      entry[Object.keys(fields)[0]!] = "' OR '1'='1"
    }
  }

  return results.slice(0, 10)
}
