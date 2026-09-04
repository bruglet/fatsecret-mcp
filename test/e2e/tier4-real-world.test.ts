import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { setupTestHarness, type TestHarnessContext } from './harness/test-server.js';
import { ConformanceServer } from './harness/conformance-server.js';
import { McpClient } from './harness/mcp-client.js';

describe('Tier 4: Real-World Scenarios', () => {
  let harness: TestHarnessContext;
  let validUserToken: string;
  let validServiceToken: string;

  before(async () => {
    harness = await setupTestHarness();
    validUserToken = await harness.jwksServer.createValidToken({
      email: 'alex.developer@company.com',
      sub: 'alex-user-id-456',
    });
    validServiceToken = await harness.jwksServer.createValidToken({
      common_name: 'service-token-agent',
      sub: 'service-token-id-789',
      type: 'service',
    });
  });

  after(async () => {
    await harness.cleanup();
  });

  // ═════════════════════════════════════════════════════════════════════
  // Scenario 1: Realistic MCP Client Lifecycle (Claude Desktop / Inspector)
  // ═════════════════════════════════════════════════════════════════════
  it('4.1: Full MCP client lifecycle: Health check -> Unauth probe (401) -> Handshake -> Tool execution -> Teardown (200) -> Post-check (404)', async () => {
    const client = new McpClient(harness.serverBaseUrl);

    // Step 1: Pre-flight readiness check
    const healthRes = await client.getHealth();
    assert.equal(healthRes.status, 200, 'Server must be healthy before handshake');
    const healthJson = await healthRes.json();
    assert.deepEqual(healthJson, { status: 'ok' });

    // Step 2: Unauthenticated probe must be rejected
    const unauthRes = await client.initialize('unauth-probe', '1.0');
    assert.equal(unauthRes.status, 401, 'Unauthenticated probe must be rejected with 401');

    // Step 3: Cloudflare Access authenticated handshake
    client.setToken(validUserToken, 'Cf-Access-Jwt-Assertion');
    const initRes = await client.initialize('claude-desktop-client', '2.1.0');
    assert.equal(initRes.status, 200, 'Authenticated handshake must succeed');
    const sessionId = client.sessionId;
    assert.ok(sessionId, 'Server must return mcp-session-id');

    // Step 4: Initialized notification
    const ackRes = await client.sendNotification('notifications/initialized');
    assert.equal(ackRes.status, 202, 'Initialized notification must return 202 Accepted');

    // Step 5: Discover tools
    const listRes = await client.listTools(10);
    assert.equal(listRes.status, 200);
    const tools = (listRes.jsonRpc?.result as { tools: Array<{ name: string }> })?.tools;
    assert.ok(Array.isArray(tools));
    assert.ok(tools.some((t) => t.name === 'get_food_entries'));

    // Step 6: Call tool
    const callRes = await client.callTool('get_food_entries', { date: '2026-09-03' }, 11);
    assert.equal(callRes.status, 200);
    const content = (callRes.jsonRpc?.result as { content: Array<{ text: string }> })?.content;
    assert.ok(content && content.length > 0);
    const parsed = JSON.parse(content[0].text);
    assert.equal(parsed.status, 'success');

    // Step 7: Graceful session teardown
    const deleteRes = await client.deleteSession();
    assert.equal(deleteRes.status, 200, 'Explicit session teardown must return 200');

    // Step 8: Post-teardown verification
    const postTeardownRes = await client.listTools(12);
    assert.equal(postTeardownRes.status, 404, 'Post-teardown calls must return 404 Session Not Found');
  });

  // ═════════════════════════════════════════════════════════════════════
  // Scenario 2: Automated Headless Agent (Service Token via Bearer)
  // ═════════════════════════════════════════════════════════════════════
  it('4.2: Automated agent workflow using Cloudflare Access Service Token in Authorization header', async () => {
    const serviceClient = new McpClient(harness.serverBaseUrl);
    serviceClient.setToken(validServiceToken, 'Authorization');

    // 1. Initialize
    const initRes = await serviceClient.initialize('cron-sync-bot', '1.0');
    assert.equal(initRes.status, 200);
    assert.ok(serviceClient.sessionId);

    // 2. Initialized ack
    const ackRes = await serviceClient.sendNotification('notifications/initialized');
    assert.equal(ackRes.status, 202);

    // 3. Search foods
    const searchRes = await serviceClient.callTool(
      'search_food',
      { search_expression: 'greek yogurt', max_results: 5 },
      501
    );
    assert.equal(searchRes.status, 200);
    const content = (searchRes.jsonRpc?.result as { content: Array<{ text: string }> })?.content;
    assert.ok(content && content.length > 0);
    const parsed = JSON.parse(content[0].text);
    assert.equal(parsed.query, 'greek yogurt');

    // Clean up
    await serviceClient.deleteSession();
  });

  // ═════════════════════════════════════════════════════════════════════
  // Scenario 3: Container Reboot & Persistent Volume Config Reload
  // ═════════════════════════════════════════════════════════════════════
  it('4.3: Container persistent storage lifecycle: save credentials -> restart server -> read saved config', async () => {
    const client = new McpClient(harness.serverBaseUrl);
    client.setToken(validUserToken);

    // 1. Initialize session on current server instance
    await client.initialize('volume-tester', '1.0');

    // 2. Persist OAuth tokens to config storage
    const saveRes = await client.callTool(
      'save_auth_credentials',
      {
        accessToken: 'reboot-persistent-token-12345',
        accessTokenSecret: 'reboot-persistent-secret-67890',
      },
      601
    );
    assert.equal(saveRes.status, 200);
    await client.deleteSession();

    // 3. Simulate container reboot: new server instance created mounting the exact same FATSECRET_CONFIG_DIR
    const newServerInstance = new ConformanceServer({
      configDir: harness.configDir,
      teamDomain: harness.jwksServer.teamDomain,
      jwksUrl: harness.jwksServer.getJwksUrl(),
      audTag: harness.jwksServer.audTag,
    });

    const loadedConfig = newServerInstance.loadConfig();
    assert.equal(loadedConfig.accessToken, 'reboot-persistent-token-12345');
    assert.equal(loadedConfig.accessTokenSecret, 'reboot-persistent-secret-67890');
  });

  // ═════════════════════════════════════════════════════════════════════
  // Scenario 4: Concurrent Liveness Monitoring Under Continuous Load
  // ═════════════════════════════════════════════════════════════════════
  it('4.4: Podman/K8s liveness probes (/health) execute reliably while MCP operations are in flight', async () => {
    const client = new McpClient(harness.serverBaseUrl);
    client.setToken(validUserToken);

    await client.initialize('load-client', '1.0');

    // Run parallel tool calls alongside health check probes
    const toolPromises = Array.from({ length: 10 }, (_, i) =>
      client.callTool('search_food', { search_expression: `item-${i}` }, 1000 + i)
    );

    const probePromises = Array.from({ length: 15 }, () => client.getHealth());

    const [toolResults, probeResults] = await Promise.all([
      Promise.all(toolPromises),
      Promise.all(probePromises),
    ]);

    for (const tr of toolResults) {
      assert.equal(tr.status, 200);
    }

    for (const pr of probeResults) {
      assert.equal(pr.status, 200);
      const body = await pr.json();
      assert.equal(body.status, 'ok');
    }

    await client.deleteSession();
  });
});
