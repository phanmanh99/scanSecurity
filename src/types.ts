export interface ToolDefinition {
  type: "function"
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ToolCall {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}

export interface Message {
  role: "system" | "user" | "assistant" | "tool"
  content: string
  tool_call_id?: string
  tool_calls?: ToolCall[]
}

export interface ChatRequest {
  model: string
  messages: Message[]
  stream?: boolean
  temperature?: number
  max_tokens?: number
  tools?: ToolDefinition[]
  tool_choice?: "auto" | "none" | "required"
}

export interface ChatResponse {
  id: string
  object: string
  created: number
  model: string
  choices: {
    index: number
    message: {
      role: string
      content: string | null
      tool_calls?: ToolCall[]
    }
    finish_reason: string | null
  }[]
}

export interface Finding {
  url: string
  status_code: number
  method: string
  error_type: string
  confidence: number
  details: string
  timestamp: string
  response_preview?: string
}

export interface ScanConfig {
  target_url: string
  username?: string
  password?: string
  login_url?: string
  model: string
  api_url: string
  max_depth: number
  max_urls: number
  concurrency: number
  output_dir: string
  max_iterations: number
  user_prompt?: string
}

export type ToolHandler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>

export interface ToolContext {
  config: ScanConfig
  cookieJar: CookieJar
  reporter: import("./tools/reporter").Reporter
  addSystemMessage: (msg: string) => void
}

export interface CookieJar {
  cookies: Map<string, string>
  setCookie(url: string, cookie: string): void
  getCookieHeader(url: string): string
  clear(): void
}

export interface CrawlResult {
  urls: string[]
  total_found: number
}

export interface RequestResult {
  status: number
  status_text: string
  headers: Record<string, string>
  body: string
  body_length: number
  url: string
  redirected?: boolean
  final_url?: string
}

export interface AnalysisResult {
  is_error: boolean
  error_type: string
  confidence: number
  reason: string
  status_code: number
}

export interface LoginResult {
  success: boolean
  message: string
  cookies?: Record<string, string>
}
