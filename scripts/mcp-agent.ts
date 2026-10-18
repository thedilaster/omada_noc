/**
 * MCP AI Agent Demonstration & Question-Answering CLI
 * 
 * Simulates and executes an LLM Agent loop interacting with the Omada NOC MCP Server
 * over the official Model Context Protocol stdio transport.
 * 
 * Usage:
 *   npx tsx scripts/mcp-agent.ts
 *   or
 *   npm run mcp:agent
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';
import fs from 'fs';

// Automatically load .env.local if present
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(envPath);
  } catch {
    // Already loaded
  }
}

interface QuestionScenario {
  question: string;
  expectedTool: 'get_network_status' | 'get_active_clients' | 'get_network_devices' | 'get_client_detail' | 'audit_network_health';
  args: Record<string, unknown>;
  reasoning: string;
}

const DEMO_SCENARIOS: QuestionScenario[] = [
  {
    question: "Perform a health audit of the network and suggest performance improvements.",
    expectedTool: "audit_network_health",
    args: {},
    reasoning: "The user is asking for a comprehensive diagnostic assessment of the network, including health scoring, potential issues, and actionable optimization advice. I will invoke `audit_network_health`.",
  },
  {
    question: "List all Access Points on the network and their current client loads.",
    expectedTool: "get_network_devices",
    args: { device_type: "ap" },
    reasoning: "The user is requesting physical AP infrastructure devices with client distribution. I will invoke `get_network_devices` with `device_type: 'ap'`.",
  },
  {
    question: "Why is the Master Bedroom TV or Ian's iPhone experiencing connectivity issues? Give me full RF metrics.",
    expectedTool: "get_client_detail",
    args: { query: "Master Bedroom TV" },
    reasoning: "The user requests an in-depth RF and link-layer diagnostic on a specific client device. I will invoke `get_client_detail` with `query: 'Master Bedroom TV'`.",
  },
  {
    question: "Which wireless clients are consuming the most bandwidth at this exact moment?",
    expectedTool: "get_active_clients",
    args: { connection_type: "wireless", sort_by: "activity", limit: 3 },
    reasoning: "The user specifically requests wireless devices sorted by instantaneous throughput (activity). I will invoke `get_active_clients` with `connection_type: 'wireless'`, `sort_by: 'activity'`, and `limit: 3`.",
  },
];

async function runMcpAgent() {
  console.log('\n======================================================');
  console.log('  🤖 Omada NOC AI Agent & MCP Protocol Runner         ');
  console.log('======================================================\n');

  console.log('🔌 Step 1: Initializing MCP Client & Connecting over Stdio...');
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
    { name: 'omada-noc-agent-client', version: '1.0.0' },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);
    console.log('   ✅ MCP Client successfully connected to Omada MCP Server.\n');

    console.log('🔍 Step 2: Discovering Available Tools via JSON-RPC `tools/list`...');
    const toolsResponse = await client.listTools();
    console.log(`   Discovered ${toolsResponse.tools.length} tool(s):`);
    toolsResponse.tools.forEach((tool) => {
      console.log(`   • \x1b[36m${tool.name}\x1b[0m: ${tool.description}`);
    });
    console.log('');

    console.log('🧠 Step 3: Executing AI Agent Question-Answering Scenarios...\n');

    const failedScenarios: string[] = [];
    for (let i = 0; i < DEMO_SCENARIOS.length; i++) {
      const scenario = DEMO_SCENARIOS[i];
      console.log('------------------------------------------------------');
      console.log(`💬 \x1b[1mScenario [${i + 1}/${DEMO_SCENARIOS.length}] User Question:\x1b[0m`);
      console.log(`   "${scenario.question}"\n`);

      console.log(`🤔 \x1b[33mAI Model Reasoning:\x1b[0m`);
      console.log(`   ${scenario.reasoning}\n`);

      console.log(`🛠️ \x1b[35mMCP JSON-RPC Tool Call:\x1b[0m`);
      console.log(`   Invoking: \x1b[1m${scenario.expectedTool}\x1b[0m(${JSON.stringify(scenario.args)})\n`);

      const startTime = Date.now();
      const result = await client.callTool({
        name: scenario.expectedTool,
        arguments: scenario.args,
      });
      const duration = Date.now() - startTime;

      const contentList = result.content as Array<{ type: string; text: string }>;
      const responseText = contentList?.[0]?.text || '';
      if (result.isError) {
        failedScenarios.push(`${scenario.expectedTool}: ${responseText.split('\n')[0]}`);
        console.log(`❌ \x1b[31mTool returned an error (${duration}ms):\x1b[0m`);
      } else {
        console.log(`⚡ \x1b[32mController Response Received (${duration}ms):\x1b[0m`);
      }
      
      // Indent response text for clean terminal presentation
      console.log(
        responseText
          .split('\n')
          .map((line) => `   ${line}`)
          .join('\n')
      );
      console.log('');
    }

    await client.close();

    console.log('======================================================');
    if (failedScenarios.length > 0) {
      console.log(`  ❌ ${failedScenarios.length} of ${DEMO_SCENARIOS.length} MCP scenario(s) failed:`);
      failedScenarios.forEach((f) => console.log(`     • ${f}`));
      console.log('======================================================\n');
      process.exit(1);
    }
    console.log('  🎉 All MCP Question-Answering Scenarios Passed!     ');
    console.log('======================================================\n');
    process.exit(0);
  } catch (error: unknown) {
    console.error('\n❌ MCP Agent Execution Failed:', error);
    await client.close().catch(() => {});
    process.exit(1);
  }
}

runMcpAgent();
