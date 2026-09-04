import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { setupTestHarness, type TestHarnessContext } from './harness/test-server.js';
import { McpClient } from './harness/mcp-client.js';

describe('Tier 3: Cross-Feature Interactions', () => {
  let harness: TestHarnessContext;
  let validToken: string;

  before(async () => {
    harness = await setupTestHarness();
    validToken = await harness.jwksServer.createValidToken();
  });

  after(async () => {
    await harness.cleanup();
  });

  // ═════════════════════════════════════════════════════════════════════
  // Interaction 1: Auth -> /mcp Tool Call
  // ═════════════════════════════════════════════════════════════════════
  it('3.1: Valid auth handshake enables end-to-end tool execution and response delivery', async () => {
    const client = new McpClient(harness.serverBaseUrl);
    client.setToken(validToken, 'Cf-Access-Jwt-Assertion');

    // 1. Initialize
    const initRes = await client.initialize('interaction-client', '1.0.0');
    assert.equal(initRes.status, 200);
    assert.ok(client.sessionId);

    // 2. Initialized notification
    const notifRes = await client.sendNotification('notifications/initialized');
    assert.equal(notifRes.status, 202);

    // 3. Execute tool call
    const callRes = await client.callTool('get_food_entries', { date: '2026-09-03' }, 101);
    assert.equal(callRes.status, 200);
    assert.ok(callRes.jsonRpc);
    assert.equal(callRes.jsonRpc?.id, 101);

    const result = callRes.jsonRpc?.result as { content?: Array<{ type: string; text: string }> };
    assert.ok(result?.content && result.content.length > 0);
    const parsedText = JSON.parse(result.content[0].text);
    assert.equal(parsedText.status, 'success');
    assert.equal(parsedText.date, '2026-09-03');

    // Clean up session
    await client.deleteSession();
  });

  // ═════════════════════════════════════════════════════════════════════
  // Interaction 2: Auth Failure -> Health Check Remains Open
  // ═════════════════════════════════════════════════════════════════════
  it('3.2: Severe auth failures on /mcp do not affect availability of public /health', async () => {
    const client = new McpClient(harness.serverBaseUrl);

    // 1. Send barrage of unauthorized requests to /mcp
    const badTokens = [
      'invalid-token-1',
      'invalid-token-2',
      await harness.jwksServer.createExpiredToken(),
      await harness.jwksServer.createWrongIssuerToken(),
      await harness.jwksServer.createWrongAudToken(),
      await harness.jwksServer.createTamperedToken(),
    ];

    for (const badToken of badTokens) {
      client.setToken(badToken);
      const res = await client.initialize('bad-probe', '1.0');
      assert.equal(res.status, 401);
    }

    // 2. Verify /health remains immediately responsive with 200 {"status":"ok"}
    const healthRes = await client.getHealth();
    assert.equal(healthRes.status, 200);
    const data = await healthRes.json();
    assert.deepEqual(data, { status: 'ok' });
  });

  // ═════════════════════════════════════════════════════════════════════
  // Interaction 3: Valid Token -> Tool Call -> Config Write & Disk Verify
  // ═════════════════════════════════════════════════════════════════════
  it('3.3: Authenticated MCP session successfully triggers config persistence to disk', async () => {
    const client = new McpClient(harness.serverBaseUrl);
    client.setToken(validToken, 'Authorization');

    const initRes = await client.initialize('config-writer', '1.0.0');
    assert.equal(initRes.status, 200);
    assert.ok(client.sessionId);

    // Call tool that persists OAuth credentials
    const callRes = await client.callTool(
      'save_auth_credentials',
      {
        accessToken: 'fatsecret-access-token-999',
        accessTokenSecret: 'fatsecret-access-secret-888',
      },
      202
    );

    assert.equal(callRes.status, 200);
    const result = callRes.jsonRpc?.result as { content?: Array<{ type: string; text: string }> };
    assert.ok(result?.content);

    // Verify file written to disk in FATSECRET_CONFIG_DIR
    const configPath = join(harness.configDir, 'config.json');
    assert.ok(existsSync(configPath), 'config.json must exist in config dir');

    const fileContent = JSON.parse(readFileSync(configPath, 'utf8'));
    assert.equal(fileContent.accessToken, 'fatsecret-access-token-999');
    assert.equal(fileContent.accessTokenSecret, 'fatsecret-access-secret-888');

    await client.deleteSession();
  });

  // ═════════════════════════════════════════════════════════════════════
  // Interaction 4: Session Persistence Across Multiple Sequential Calls
  // ═════════════════════════════════════════════════════════════════════
  it('3.4: Active session preserves state across multiple sequential tool lists and calls', async () => {
    const client = new McpClient(harness.serverBaseUrl);
    client.setToken(validToken);

    // Handshake
    const initRes = await client.initialize('seq-client', '1.0.0');
    assert.equal(initRes.status, 200);
    const assignedSessionId = client.sessionId;
    assert.ok(assignedSessionId);

    // Call 1: List tools
    const list1 = await client.listTools(1);
    assert.equal(list1.status, 200);
    assert.equal(client.sessionId, assignedSessionId);

    // Call 2: Search food
    const call1 = await client.callTool('search_food', { search_expression: 'apple' }, 2);
    assert.equal(call1.status, 200);
    assert.equal(client.sessionId, assignedSessionId);

    // Call 3: List tools again
    const list2 = await client.listTools(3);
    assert.equal(list2.status, 200);
    assert.equal(client.sessionId, assignedSessionId);

    // Call 4: Get food entries
    const call2 = await client.callTool('get_food_entries', { date: '2026-09-03' }, 4);
    assert.equal(call2.status, 200);
    assert.equal(client.sessionId, assignedSessionId);

    // Terminate session
    await client.deleteSession();
  });

  // ═════════════════════════════════════════════════════════════════════
  // Interaction 5: Token Expiration Mid-Session
  // ═════════════════════════════════════════════════════════════════════
  it('3.5: Token expiring mid-session blocks request with 401 while valid token restores access', async () => {
    const client = new McpClient(harness.serverBaseUrl);
    client.setToken(validToken);

    // 1. Start with valid token
    const initRes = await client.initialize('token-swap-client', '1.0');
    assert.equal(initRes.status, 200);
    const activeSessionId = client.sessionId;
    assert.ok(activeSessionId);

    // 2. Subsequent call with expired token is rejected
    const expiredToken = await harness.jwksServer.createExpiredToken();
    client.setToken(expiredToken);
    const badRes = await client.listTools(5);
    assert.equal(badRes.status, 401);

    // 3. Supplying fresh valid token restores session access
    const freshToken = await harness.jwksServer.createValidToken({ sub: 'user-refreshed' });
    client.setToken(freshToken);
    client.sessionId = activeSessionId; // Preserve session ID
    const goodRes = await client.listTools(6);
    assert.equal(goodRes.status, 200);

    await client.deleteSession();
  });

  // ═════════════════════════════════════════════════════════════════════
  // Interaction 6: Multi-Client Session Isolation
  // ═════════════════════════════════════════════════════════════════════
  it('3.6: Concurrent independent client sessions do not cross-talk or interfere on delete', async () => {
    const tokenA = await harness.jwksServer.createValidToken({ sub: 'client-A' });
    const tokenB = await harness.jwksServer.createValidToken({ sub: 'client-B' });

    const clientA = new McpClient(harness.serverBaseUrl);
    clientA.setToken(tokenA);
    const initA = await clientA.initialize('client-A', '1.0');
    assert.equal(initA.status, 200);
    const sessionA = clientA.sessionId;
    assert.ok(sessionA);

    const clientB = new McpClient(harness.serverBaseUrl);
    clientB.setToken(tokenB);
    const initB = await clientB.initialize('client-B', '1.0');
    assert.equal(initB.status, 200);
    const sessionB = clientB.sessionId;
    assert.ok(sessionB);

    assert.notEqual(sessionA, sessionB, 'Different clients must receive distinct session IDs');

    // Both execute tools
    const listA = await clientA.listTools(1);
    assert.equal(listA.status, 200);

    const listB = await clientB.listTools(1);
    assert.equal(listB.status, 200);

    // Delete client A's session
    const delA = await clientA.deleteSession();
    assert.equal(delA.status, 200);

    // Client A is now gone (404)
    const postDelA = await clientA.listTools(2);
    assert.equal(postDelA.status, 404);

    // Client B remains fully operational (200)
    const postDelB = await clientB.listTools(2);
    assert.equal(postDelB.status, 200);

    // Clean up B
    await clientB.deleteSession();
  });
});
