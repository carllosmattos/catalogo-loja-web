import { appBaseUrl } from "@/lib/payments";

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type LlmTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type LlmResult = {
  content: string | null;
  tool_calls: ToolCall[] | null;
  model: string;
};

function llmApiKey(): string {
  return (
    process.env.OPENROUTER_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    ""
  );
}

function llmBaseUrl(): string {
  return (
    process.env.OPENAI_BASE_URL?.trim() ||
    "https://openrouter.ai/api/v1"
  ).replace(/\/$/, "");
}

function llmModels(): string[] {
  const raw =
    process.env.LLM_MODELS?.trim() ||
    "google/gemma-4-26b-a4b-it:free,meta-llama/llama-3.3-70b-instruct:free,openai/gpt-oss-20b:free";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function llmConfigured(): boolean {
  return Boolean(llmApiKey());
}

/**
 * Chat Completions via OpenRouter (OpenAI-compatible) com failover de modelos.
 */
export async function chatCompletion(opts: {
  messages: ChatMessage[];
  tools?: LlmTool[];
  temperature?: number;
}): Promise<LlmResult> {
  const key = llmApiKey();
  if (!key) {
    throw new Error("OPENROUTER_API_KEY não configurada");
  }

  const models = llmModels();
  const base = llmBaseUrl();
  let lastError = "Nenhum modelo disponível";

  for (const model of models) {
    try {
      const body: Record<string, unknown> = {
        model,
        messages: opts.messages,
        temperature: opts.temperature ?? 0.4,
        stream: false,
      };
      if (opts.tools?.length) {
        body.tools = opts.tools;
        body.tool_choice = "auto";
      }

      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "HTTP-Referer": appBaseUrl(),
          "X-Title": "LM Moda Chat",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        lastError = `HTTP ${res.status} ${model}: ${text.slice(0, 200)}`;
        // 429 / 5xx → próximo modelo
        if (res.status === 429 || res.status >= 500 || res.status === 404) {
          continue;
        }
        // 400 com tools unsupported → tenta sem tools no mesmo model? skip to next
        continue;
      }

      const data = (await res.json()) as {
        choices?: Array<{
          message?: {
            content?: string | null;
            tool_calls?: ToolCall[];
          };
        }>;
      };
      const msg = data.choices?.[0]?.message;
      if (!msg) {
        lastError = `Resposta vazia (${model})`;
        continue;
      }

      return {
        content: typeof msg.content === "string" ? msg.content : null,
        tool_calls: Array.isArray(msg.tool_calls) ? msg.tool_calls : null,
        model,
      };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      continue;
    }
  }

  throw new Error(lastError);
}
