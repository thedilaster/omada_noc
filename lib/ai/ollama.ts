/**
 * Local Ollama Client & Neural Inference Engine
 *
 * Interfaces with a locally running Ollama instance (default: http://127.0.0.1:11434)
 * to execute real generative LLM reasoning over live network telemetry.
 */

export interface OllamaGenerateResponse {
  model: string;
  response: string;
  thinking?: string;
  totalDurationMs?: number;
  evalCount?: number;
}

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaModelInfo {
  name: string;
  model: string;
  size: number;
}

export function getOllamaBaseUrl(): string {
  return process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
}

export function getOllamaDefaultModel(): string {
  return process.env.OLLAMA_MODEL || 'deepseek-r1:7b';
}

function getOllamaTimeoutMs(): number {
  const ms = Number(process.env.OLLAMA_TIMEOUT_MS);
  return Number.isFinite(ms) && ms > 0 ? ms : 120000;
}

/**
 * Splits DeepSeek-R1 style output into its chain-of-thought and the remaining answer.
 * Handles closed <think>…</think> blocks, an unclosed <think> (truncated output: runs to the end),
 * and a bare leading "…</think>" (chat templates that open the think block in the prompt).
 */
export function splitThinking(raw: string): { thinking?: string; answer: string } {
  const thoughts: string[] = [];
  let answer = raw.replace(/<think>([\s\S]*?)<\/think>/gi, (_match, thought: string) => {
    thoughts.push(thought.trim());
    return '';
  });

  const unclosed = answer.search(/<think>/i);
  if (unclosed !== -1) {
    thoughts.push(answer.slice(unclosed + '<think>'.length).trim());
    answer = answer.slice(0, unclosed);
  }

  const orphanClose = answer.search(/<\/think>/i);
  if (orphanClose !== -1) {
    thoughts.unshift(answer.slice(0, orphanClose).trim());
    answer = answer.slice(orphanClose + '</think>'.length);
  }

  const thinking = thoughts.filter(Boolean).join('\n\n');
  return { thinking: thinking || undefined, answer: answer.trim() };
}

/** Removes any chain-of-thought (<think> blocks, closed or not) from model output. */
export function stripThinking(raw: string): string {
  return splitThinking(raw).answer;
}

/**
 * Returns the first balanced `{…}` block in `text` that parses as a JSON object, or null.
 * Brace matching is string-aware, so braces inside JSON strings or stray prose braces don't break it.
 */
export function extractJsonObject<T = Record<string, unknown>>(text: string): T | null {
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            const parsed: unknown = JSON.parse(text.slice(start, i + 1));
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              return parsed as T;
            }
          } catch {
            // Not valid JSON: try the next opening brace
          }
          break;
        }
      }
    }
  }
  return null;
}

/**
 * Checks if local Ollama server is running and returns available models.
 */
export async function getOllamaStatus(baseUrl = getOllamaBaseUrl()): Promise<{
  online: boolean;
  models: string[];
  error?: string;
}> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return { online: false, models: [], error: `Ollama returned HTTP ${res.status}` };
    }

    const data = (await res.json()) as { models?: OllamaModelInfo[] };
    const models = (data.models || []).map((m) => m.name || m.model);
    return { online: true, models };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Connection refused';
    return {
      online: false,
      models: [],
      error: `Ollama unreachable at ${baseUrl} (${msg})`,
    };
  }
}

/**
 * Executes real neural inference with DeepSeek-R1 or another local Ollama model.
 * Extracts Chain-of-Thought reasoning (<think>...</think>) from DeepSeek-R1.
 */
export async function generateNeuralAiInsight(
  systemPrompt: string,
  userPrompt: string,
  model = getOllamaDefaultModel(),
  baseUrl = getOllamaBaseUrl()
): Promise<OllamaGenerateResponse> {
  const startTime = Date.now();

  const controller = new AbortController();
  // Local 7B / 14B inference on GPU/CPU can be slow (OLLAMA_TIMEOUT_MS, default 120s)
  const timeoutMs = getOllamaTimeoutMs();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: `${systemPrompt}\n\nUser Request & Telemetry Payload:\n${userPrompt}`,
        stream: false,
        options: {
          temperature: 0.3,
          // R1 models spend many tokens inside <think>; 2048 truncated them before the JSON answer
          num_predict: 4096,
        },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Ollama API error (${res.status}): ${errBody || res.statusText}`);
    }

    const data = (await res.json()) as {
      response?: string;
      model?: string;
      total_duration?: number;
      eval_count?: number;
    };

    const rawResponse = data.response || '';
    const totalDurationMs = Date.now() - startTime;

    // Extract DeepSeek-R1 Chain-of-Thought (<think>...</think>, possibly unclosed when truncated)
    const { thinking, answer } = splitThinking(rawResponse);

    return {
      model: data.model || model,
      response: answer,
      thinking,
      totalDurationMs,
      evalCount: data.eval_count,
    };
  } catch (err: unknown) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Ollama neural inference timed out after ${Math.round(timeoutMs / 1000)}s on model '${model}'.`);
    }
    throw err;
  }
}
