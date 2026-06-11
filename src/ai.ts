import type { Message, ToolDefinition, ChatRequest, ChatResponse } from "./types"

export async function callAI(
  apiUrl: string,
  model: string,
  messages: Message[],
  tools?: ToolDefinition[],
): Promise<ChatResponse> {
  const body: ChatRequest = {
    model,
    messages,
    stream: false,
    temperature: 0.3,
    max_tokens: 128000,
  }

  if (tools && tools.length > 0) {
    body.tools = tools
    body.tool_choice = "auto"
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => "unknown")
    throw new Error(`AI API error ${response.status}: ${errText.substring(0, 500)}`)
  }

  const data = (await response.json()) as ChatResponse
  return data
}
