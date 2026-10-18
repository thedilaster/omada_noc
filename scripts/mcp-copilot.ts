/**
 * Interactive Omada Network AI Copilot CLI
 *
 * Real Neural LLM Copilot that bridges local Ollama models (default: deepseek-r1:7b)
 * to the Omada NOC Model Context Protocol (MCP) Server over stdio.
 *
 * When an LLM is online, it performs autonomous tool selection, executes MCP tools,
 * and streams neural diagnostic reasoning.
 *
 * Usage:
 *   npx tsx scripts/mcp-copilot.ts
 *   or
 *   npm run mcp:copilot
 */

import readline from 'readline';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';
import fs from 'fs';
import { extractJsonObject, stripThinking } from '../lib/ai/ollama';

// Automatically load .env.local if present
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(envPath);
  } catch {
    // Loaded
  }
}

const OLLAMA_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'deepseek-r1:7b';

async function checkOllama(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function queryOllama(prompt: string, model = OLLAMA_MODEL): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: { temperature: 0.2, num_predict: 4096 },
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Ollama error HTTP ${res.status}`);
  const data = (await res.json()) as { response?: string };
  return data.response || '';
}

/** Keyword routing used when Ollama is offline or its tool selection can't be parsed. */
function selectToolHeuristically(input: string): { toolName: string; toolArgs: Record<string, unknown> } {
  const lower = input.toLowerCase();
  // Word boundaries: "ap" must not match "happening", "laptop", ...
  const has = (pattern: RegExp) => pattern.test(lower);
  const mentionsAp = has(/\b(aps?|access[- ]points?)\b/);
  const mentionsSwitch = has(/\bswitch(es)?\b/);

  if (has(/\b(audit|health|score)\b/)) {
    return { toolName: 'audit_network_health', toolArgs: {} };
  }
  if (mentionsAp || mentionsSwitch || has(/\b(devices?|hardware|gateways?)\b/)) {
    return {
      toolName: 'get_network_devices',
      toolArgs: { device_type: mentionsAp ? 'ap' : mentionsSwitch ? 'switch' : 'all' },
    };
  }
  if (has(/\b(inspect|detail|details|why)\b/) || lower.includes('192.')) {
    return {
      toolName: 'get_client_detail',
      toolArgs: { query: input.replace(/inspect|detail|lookup|why is/gi, '').trim() || input },
    };
  }
  if (has(/\b(clients?|bandwidth|traffic)\b/)) {
    return { toolName: 'get_active_clients', toolArgs: { connection_type: 'wireless', sort_by: 'activity', limit: 5 } };
  }
  return { toolName: 'get_network_status', toolArgs: {} };
}

async function startCopilot() {
  console.log('\n===============================================================');
  console.log('  🌐 Omada Network AI Copilot (Live Neural Agent CLI)         ');
  console.log('===============================================================\n');

  const isOllamaOnline = await checkOllama();
  if (isOllamaOnline) {
    console.log(`🤖 \x1b[32mNeural LLM Backend:\x1b[0m Connected to Ollama (${OLLAMA_MODEL} at ${OLLAMA_URL})`);
  } else {
    console.log(`⚠️  \x1b[33mNeural LLM Backend:\x1b[0m Ollama offline. Operating in direct MCP tool routing mode.`);
  }

  console.log('🔌 Connecting to Omada NOC MCP Bridge...');

  const cliPath = path.resolve(process.cwd(), 'mcp/cli.ts');
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', cliPath],
    env: {
      ...process.env,
      OMADA_URL: process.env.OMADA_URL || '192.168.100.2',
      OMADA_SITE: process.env.OMADA_SITE || 'Default',
      // OMADA_ALLOW_INSECURE_SSL is inherited from the environment (TLS verification stays on unless it is "true")
    },
  });

  const client = new Client(
    { name: 'omada-copilot-client', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  const toolsResult = await client.listTools();
  console.log(`✅ Connected! Available MCP Tools: ${toolsResult.tools.map((t) => t.name).join(', ')}\n`);
  console.log('💡 Example questions you can ask:');
  console.log('  • "Audit the network and identify any performance bottlenecks."');
  console.log('  • "List all Access Points and their current client counts."');
  console.log('  • "Which wireless devices are consuming the highest bandwidth?"');
  console.log('  • "Why is device 192.168.100.74 experiencing poor connectivity?"');
  console.log('  • Type "exit" or "quit" to leave.\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askQuestion = () => {
    rl.question('\n\x1b[1m\x1b[36mYou:\x1b[0m ', async (userInput) => {
      const input = userInput.trim();
      if (!input || input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
        console.log('\n👋 Exiting Omada Copilot. Goodbye!');
        await client.close().catch(() => {});
        rl.close();
        process.exit(0);
      }

      console.log('\n🤔 \x1b[33mSelecting MCP Tool & Reasoning...\x1b[0m');

      try {
        let { toolName, toolArgs } = selectToolHeuristically(input);

        if (isOllamaOnline) {
          // Use real Neural LLM to select tool & parameters
          const toolSelectionPrompt = `You are an AI router for a network NOC. Given the user's question, select the SINGLE best MCP tool to call.
Available Tools:
1. get_network_status: Controller online status, client counts, total bandwidth.
2. get_active_clients (args: connection_type: 'all'|'wired'|'wireless', sort_by: 'activity'|'traffic'|'uptime', limit: number): Client device inventory and bandwidth.
3. get_network_devices (args: device_type: 'all'|'ap'|'switch'|'gateway'): Physical hardware inventory and health.
4. get_client_detail (args: query: string): Deep RF signal, RSSI, IP/MAC, AP association for a single client.
5. audit_network_health: Full diagnostic health score, warnings, and suggestions.

User Question: "${input}"

Respond ONLY with a valid JSON object (no markdown, no other text):
{"tool": "<tool_name>", "args": {<arguments>}}`;

          try {
            const llmSelection = await queryOllama(toolSelectionPrompt);
            // Strip <think> reasoning first so braces in it can't be mistaken for the answer
            const parsed = extractJsonObject<{ tool?: unknown; args?: unknown }>(stripThinking(llmSelection));
            if (parsed && typeof parsed.tool === 'string') {
              toolName = parsed.tool;
              toolArgs = parsed.args && typeof parsed.args === 'object' ? (parsed.args as Record<string, unknown>) : {};
            }
          } catch {
            // Keep the heuristic selection
          }
        }

        console.log(`🛠️  \x1b[35mInvoking MCP Tool:\x1b[0m \x1b[1m${toolName}\x1b[0m(${JSON.stringify(toolArgs)})`);

        const startTime = Date.now();
        const res = await client.callTool({
          name: toolName,
          arguments: toolArgs,
        });
        const duration = Date.now() - startTime;

        const contentList = res.content as Array<{ type: string; text: string }>;
        const rawTelemetry = contentList?.[0]?.text || '';

        console.log(`⚡ \x1b[32mReceived Live Telemetry from Controller (${duration}ms)\x1b[0m`);

        if (isOllamaOnline) {
          // Pass raw telemetry back to LLM for final synthesis
          console.log(`🧠 \x1b[36m${OLLAMA_MODEL} Synthesizing Response...\x1b[0m\n`);
          const synthesisPrompt = `You are a Principal NOC Reliability Engineer.
The user asked: "${input}"
The live Omada network telemetry returned by the MCP tool is:
${rawTelemetry}

Provide a concise, direct, and actionable answer to the user's question based strictly on this real telemetry.`;

          const answer = await queryOllama(synthesisPrompt);
          // Strip think tags (closed or truncated) if present
          console.log(stripThinking(answer) || '(The model returned only reasoning; no final answer.)');
        } else {
          console.log('\n' + rawTelemetry);
        }
      } catch (err: unknown) {
        console.error('❌ Error executing copilot query:', err);
      }

      askQuestion();
    });
  };

  askQuestion();
}

startCopilot().catch(console.error);
