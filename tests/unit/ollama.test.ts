import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getOllamaStatus, generateNeuralAiInsight, splitThinking, stripThinking, extractJsonObject } from '@/lib/ai/ollama';

describe('Local Ollama Client Module (lib/ai/ollama.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('checks Ollama status successfully when online', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { name: 'deepseek-r1:7b', model: 'deepseek-r1:7b', size: 4000000 },
          { name: 'qwen2.5-coder:14b', model: 'qwen2.5-coder:14b', size: 9000000 },
        ],
      }),
    });

    const status = await getOllamaStatus();
    expect(status.online).toBe(true);
    expect(status.models).toContain('deepseek-r1:7b');
    expect(status.models).toContain('qwen2.5-coder:14b');
  });

  it('handles Ollama offline connection errors gracefully', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    const status = await getOllamaStatus();
    expect(status.online).toBe(false);
    expect(status.models).toEqual([]);
    expect(status.error).toContain('Connection refused');
  });

  it('handles HTTP error status from Ollama', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    });

    const status = await getOllamaStatus();
    expect(status.online).toBe(false);
    expect(status.error).toContain('HTTP 503');
  });

  it('generates neural AI insight and extracts Chain-of-Thought thinking process', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'deepseek-r1:7b',
        response: '<think>\nEvaluating RF channels...\n</think>\n{"healthScore": 96}',
        total_duration: 1200000,
        eval_count: 85,
      }),
    });

    const result = await generateNeuralAiInsight('system', 'user');
    expect(result.model).toBe('deepseek-r1:7b');
    expect(result.thinking).toBe('Evaluating RF channels...');
    expect(result.response).toBe('{"healthScore": 96}');
    expect(result.evalCount).toBe(85);
  });

  it('strips an unclosed <think> block (truncated output) from the response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: 'Preamble <think>still reasoning about {"healthScore": 1', eval_count: 4096 }),
    });

    const result = await generateNeuralAiInsight('system', 'user', 'deepseek-r1:14b');
    expect(result.model).toBe('deepseek-r1:14b');
    expect(result.response).toBe('Preamble');
    expect(result.thinking).toBe('still reasoning about {"healthScore": 1');
  });

  it('reports the configured timeout when inference is aborted', async () => {
    process.env.OLLAMA_TIMEOUT_MS = '5000';
    global.fetch = vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    try {
      await expect(generateNeuralAiInsight('system', 'user', 'm')).rejects.toThrow(/timed out after 5s on model 'm'/);
    } finally {
      delete process.env.OLLAMA_TIMEOUT_MS;
    }
    global.fetch = vi.fn().mockRejectedValue(new Error('socket hang up'));
    await expect(generateNeuralAiInsight('system', 'user')).rejects.toThrow('socket hang up');
  });

  describe('splitThinking / stripThinking', () => {
    it('handles closed, multiple, unclosed and orphan-closing think tags', () => {
      expect(splitThinking('no tags')).toEqual({ thinking: undefined, answer: 'no tags' });
      expect(splitThinking('<think>a</think>X<THINK>b</THINK>Y')).toEqual({ thinking: 'a\n\nb', answer: 'XY' });
      expect(splitThinking('Answer<think>cut off')).toEqual({ thinking: 'cut off', answer: 'Answer' });
      expect(splitThinking('reasoning only</think>{"a":1}')).toEqual({ thinking: 'reasoning only', answer: '{"a":1}' });
      expect(splitThinking('<think></think>done')).toEqual({ thinking: undefined, answer: 'done' });
      expect(stripThinking('<think>x</think> {"tool": "t"} ')).toBe('{"tool": "t"}');
    });
  });

  describe('extractJsonObject', () => {
    it('returns the first balanced block that parses as an object', () => {
      expect(extractJsonObject('Use {placeholder} then {"a": {"b": 2}} and {"c": 3}')).toEqual({ a: { b: 2 } });
      expect(extractJsonObject('```json\n{"s": "brace } and \\" quote {"}\n```')).toEqual({ s: 'brace } and " quote {' });
      expect(extractJsonObject('[1, 2] {"ok": true}')).toEqual({ ok: true });
    });

    it('returns null when no JSON object is present or it is truncated', () => {
      expect(extractJsonObject('no json here')).toBeNull();
      expect(extractJsonObject('{"healthScore": 5')).toBeNull();
      expect(extractJsonObject('{not: json}')).toBeNull();
    });
  });

  it('throws descriptive error when Ollama API returns error response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => 'model not found',
    });

    await expect(generateNeuralAiInsight('system', 'user')).rejects.toThrow(/Ollama API error \(404\)/);
  });
});
