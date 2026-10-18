import { describe, it, expect, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';
import fs from 'fs';

// Only `npm run test:integration` talks to the real controller (using .env.local). Plain test runs
// point the server at an unconfigured client so no login attempts can lock the controller out.
const LIVE_CONTROLLER = process.env.OMADA_INTEGRATION === '1';

const envPath = path.resolve(process.cwd(), '.env.local');
if (LIVE_CONTROLLER && fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(envPath);
  } catch {
    // Loaded
  }
}

describe('MCP Client-Server End-to-End Integration', () => {
  let client: Client;
  let transport: StdioClientTransport;

  afterAll(async () => {
    if (client) {
      await client.close().catch(() => {});
    }
  });

  it('connects to the Omada MCP Server via stdio and discovers tools', async () => {
    const cliPath = path.resolve(process.cwd(), 'mcp/cli.ts');

    transport = new StdioClientTransport({
      command: 'npx',
      args: ['tsx', cliPath],
      env: {
        ...process.env,
        ...(LIVE_CONTROLLER
          ? { OMADA_ALLOW_INSECURE_SSL: process.env.OMADA_ALLOW_INSECURE_SSL || 'true' }
          : { OMADA_URL: 'https://127.0.0.1:1', OMADA_USER: '', OMADA_PASS: '' }),
      },
    });

    client = new Client({ name: 'mcp-integration-test-client', version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);

    const toolsResult = await client.listTools();
    expect(toolsResult).toBeDefined();
    expect(toolsResult.tools).toBeInstanceOf(Array);

    const toolNames = toolsResult.tools.map((t) => t.name);
    expect(toolNames).toContain('get_network_status');
    expect(toolNames).toContain('get_active_clients');
    expect(toolNames).toContain('get_network_devices');
    expect(toolNames).toContain('get_client_detail');
    expect(toolNames).toContain('audit_network_health');

    const activeClientsTool = toolsResult.tools.find((t) => t.name === 'get_active_clients');
    expect(activeClientsTool?.inputSchema).toBeDefined();
  }, 15000);

  it('invokes get_network_status via MCP JSON-RPC protocol', async () => {
    const response = await client.callTool({
      name: 'get_network_status',
      arguments: {},
    });

    expect(response).toBeDefined();
    const content = response.content as Array<{ type: string; text: string }>;
    expect(content).toBeInstanceOf(Array);
    expect(content.length).toBeGreaterThan(0);
    const text = content[0]?.text || '';
    expect(text.length).toBeGreaterThan(10);
    expect(text).toMatch(/Omada Network Status|Omada Controller/);
  }, 15000);

  it('invokes get_active_clients with parameters (connection_type, sort_by, limit) via MCP JSON-RPC protocol', async () => {
    const response = await client.callTool({
      name: 'get_active_clients',
      arguments: {
        connection_type: 'all',
        sort_by: 'activity',
        limit: 3,
      },
    });

    expect(response).toBeDefined();
    const content = response.content as Array<{ type: string; text: string }>;
    expect(content).toBeInstanceOf(Array);
    expect(content.length).toBeGreaterThan(0);
    const text = content[0]?.text || '';
    expect(text.length).toBeGreaterThan(10);
    expect(text).toMatch(/Active Clients|No active clients|Error retrieving active clients|Omada/);
  }, 15000);

  it('invokes get_network_devices and audit_network_health via MCP JSON-RPC protocol', async () => {
    const devicesRes = await client.callTool({
      name: 'get_network_devices',
      arguments: { device_type: 'all' },
    });
    expect(devicesRes).toBeDefined();
    const devContent = devicesRes.content as Array<{ type: string; text: string }>;
    expect(devContent[0]?.text).toMatch(/Network Infrastructure Devices|No network infrastructure|Error/);

    const auditRes = await client.callTool({
      name: 'audit_network_health',
      arguments: {},
    });
    expect(auditRes).toBeDefined();
    const auditContent = auditRes.content as Array<{ type: string; text: string }>;
    expect(auditContent[0]?.text).toMatch(/Network Health & Performance Audit|Health Score|Error/);
  }, 15000);
});
