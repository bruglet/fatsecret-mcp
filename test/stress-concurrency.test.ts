import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { McpClient } from './e2e/harness/mcp-client.js';
import { saveConfigFile, loadConfigFile, type Config } from '../src/config.js';

interface ServerHarness {
  baseUrl: string;
  configDir: string;
  process: ChildProcess;
  stop: () => Promise<void>;
}

async function startRealServer(): Promise<ServerHarness> {
  const port = Math.floor(Math.random() * 10000) + 32000;
  const configDir = mkdtempSync(join(tmpdir(), 'fatsecret-stress-'));
  const baseUrl = `http://127.0.0.1:${port}`;

  const proc = spawn('/var/home/brug/.local/bin/node', ['--import', 'tsx', 'src/index.ts'], {
    env: {
      ...process.env,
      PORT: String(port),
      FATSECRET_CONFIG_DIR: configDir,
    },
    stdio: 'pipe',
  });

  // Wait for server to become responsive
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      // Server not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  if (!ready) {
    proc.kill('SIGKILL');
    throw new Error(`Server failed to start on port ${port} within timeout`);
  }

  const stop = async () => {
    proc.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      proc.on('exit', () => resolve());
      setTimeout(() => {
        proc.kill('SIGKILL');
        resolve();
      }, 3000).unref();
    });
    try {
      rmSync(configDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  };

  return { baseUrl, configDir, process: proc, stop };
}

test('Stress Challenge 1: Concurrent Sessions & Session Isolation', async (t) => {
  const harness = await startRealServer();

  t.after(async () => {
    await harness.stop();
  });

  await t.test('Burst of 25 concurrent client initializations creates distinct sessions without collision', async () => {
    const clientCount = 25;
    const clients: McpClient[] = Array.from({ length: clientCount }, () => new McpClient(harness.baseUrl));

    // Launch all 25 initializations simultaneously
    const initResponses = await Promise.all(
      clients.map((c, idx) => c.initialize(`stress-client-${idx}`, `1.0.${idx}`))
    );

    const sessionIds = new Set<string>();

    for (let i = 0; i < clientCount; i++) {
      const res = initResponses[i];
      assert.strictEqual(res.status, 200, `Client ${i} init status should be 200`);
      assert.ok(res.sessionId, `Client ${i} must receive an mcp-session-id`);
      assert.ok(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(res.sessionId!),
        `Client ${i} session ID should be a valid UUID`
      );
      assert.strictEqual(
        sessionIds.has(res.sessionId!),
        false,
        `Session ID collision detected: ${res.sessionId}`
      );
      sessionIds.add(res.sessionId!);
      assert.ok(res.jsonRpc?.result, `Client ${i} must receive jsonRpc result`);
    }

    assert.strictEqual(sessionIds.size, clientCount, 'All 25 clients must possess globally unique sessions');
  });

  await t.test('Concurrent operations across distinct sessions remain isolated and responsive', async () => {
    const clientCount = 15;
    const clients: McpClient[] = Array.from({ length: clientCount }, () => new McpClient(harness.baseUrl));

    // Initialize all clients
    await Promise.all(clients.map((c, idx) => c.initialize(`client-${idx}`)));

    // Send initialized notifications concurrently
    const notifResponses = await Promise.all(
      clients.map((c) => c.sendNotification('notifications/initialized'))
    );
    for (const res of notifResponses) {
      assert.strictEqual(res.status, 202, 'Notification must return 202 Accepted');
    }

    // Concurrently list tools across all 15 sessions
    const toolListResponses = await Promise.all(
      clients.map((c, idx) => c.listTools(100 + idx))
    );

    for (let i = 0; i < clientCount; i++) {
      const res = toolListResponses[i];
      assert.strictEqual(res.status, 200, `Client ${i} tools/list should return 200`);
      assert.strictEqual(res.jsonRpc?.id, 100 + i, `Response ID should match client request ID for client ${i}`);
      const tools = (res.jsonRpc?.result as { tools?: unknown[] })?.tools;
      assert.ok(Array.isArray(tools), `Client ${i} must receive tools array`);
      assert.strictEqual(tools!.length, 44, `Client ${i} must see all 44 registered tools`);
    }
  });

  await t.test('Concurrent SSE streams on distinct sessions open without cross-session interference', async () => {
    const clients = [new McpClient(harness.baseUrl), new McpClient(harness.baseUrl), new McpClient(harness.baseUrl)];
    await Promise.all(clients.map((c) => c.initialize()));

    const sseResponses = await Promise.all(clients.map((c) => c.getMcpStream()));

    for (let i = 0; i < clients.length; i++) {
      assert.strictEqual(sseResponses[i].status, 200, `Client ${i} SSE stream should return 200`);
      const contentType = sseResponses[i].headers.get('content-type') || '';
      assert.ok(contentType.includes('text/event-stream'), `Client ${i} should receive text/event-stream`);
    }
  });
});

test('Stress Challenge 2: Concurrent Writes & Atomic Filesystem Storage', async (t) => {
  await t.test('Direct module: 50 concurrent writes and 50 concurrent reads never corrupt JSON', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'fatsecret-config-stress-'));
    const configPath = join(tempDir, 'config.json');

    try {
      const writeCount = 50;
      let readCount = 0;
      let readErrors = 0;
      let keepReading = true;

      // Perform 50 concurrent parallel writes and 50 concurrent reads simultaneously
      const writePromises = Array.from({ length: writeCount }, async (_, idx) => {
        const key = `field_${idx}`;
        const val = `value_${idx}_${Math.random().toString(36).slice(2)}`;
        await new Promise((r) => setTimeout(r, Math.random() * 10));
        saveConfigFile({ [key]: val }, configPath);
      });

      const readPromises = Array.from({ length: 50 }, async () => {
        await new Promise((r) => setTimeout(r, Math.random() * 10));
        try {
          readCount++;
          const cfg = loadConfigFile(configPath);
          assert.strictEqual(typeof cfg, 'object');
          assert.ok(!Array.isArray(cfg));
        } catch {
          readErrors++;
        }
      });

      await Promise.all([...writePromises, ...readPromises]);

      assert.strictEqual(readErrors, 0, 'No JSON parse or syntax errors should occur during concurrent reads');
      assert.strictEqual(readCount, 50, 'All 50 concurrent reads should have executed');

      // Verify file on disk is valid JSON and contains written properties
      const raw = readFileSync(configPath, 'utf-8');
      const finalConfig = JSON.parse(raw);
      assert.strictEqual(typeof finalConfig, 'object');

      // The final file should have merged fields
      const keys = Object.keys(finalConfig);
      assert.ok(keys.length > 0, 'Config file should have persisted properties');
    } finally {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  await t.test('Direct module: Rapid parallel writes to non-existent deep directory handle race condition without error', async () => {
    const parentDir = mkdtempSync(join(tmpdir(), 'fatsecret-nested-race-'));
    const deepDir = join(parentDir, 'deep', 'level1', 'level2');
    const targetFile = join(deepDir, 'config.json');

    try {
      // 20 parallel writes to a directory that does not yet exist
      const promises = Array.from({ length: 20 }, (_, idx) =>
        (async () => {
          await new Promise((r) => setTimeout(r, Math.random() * 5));
          saveConfigFile({ [`prop_${idx}`]: idx }, targetFile);
        })()
      );

      const results = await Promise.allSettled(promises);
      const rejected = results.filter((r) => r.status === 'rejected');

      assert.strictEqual(rejected.length, 0, 'Concurrent mkdirSync and writes should not reject on existing directory');
      assert.ok(existsSync(targetFile), 'Target config file should exist');

      const loaded = loadConfigFile(targetFile);
      assert.ok(Object.keys(loaded).length > 0, 'Target file should contain saved data');
    } finally {
      try {
        rmSync(parentDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  await t.test('Server tool execution: Concurrent setup_credentials calls from multiple sessions preserve config integrity', async () => {
    const harness = await startRealServer();

    try {
      const clientCount = 8;
      const clients: McpClient[] = Array.from({ length: clientCount }, () => new McpClient(harness.baseUrl));

      await Promise.all(clients.map((c, idx) => c.initialize(`setup-client-${idx}`)));

      // Concurrently invoke setup_credentials with distinct keys
      const toolCallPromises = clients.map((c, idx) =>
        c.callTool('setup_credentials', {
          client_id: `client_id_${idx}`,
          client_secret: `client_secret_${idx}`,
          consumer_secret: `consumer_secret_${idx}`,
        })
      );

      const results = await Promise.all(toolCallPromises);

      for (let i = 0; i < clientCount; i++) {
        const res = results[i];
        assert.strictEqual(res.status, 200, `Client ${i} setup_credentials should return 200`);
        assert.ok(res.jsonRpc?.result, `Client ${i} should receive result payload`);
      }

      // Check config file on disk
      const configPath = join(harness.configDir, 'config.json');
      assert.ok(existsSync(configPath), 'Config file must exist on disk');

      const raw = readFileSync(configPath, 'utf-8');
      let parsed: Config;
      assert.doesNotThrow(() => {
        parsed = JSON.parse(raw);
      }, 'Config file on disk must be valid, uncorrupted JSON');

      assert.ok(parsed!.clientId, 'Final config must have a clientId');
      assert.ok(parsed!.clientSecret, 'Final config must have a clientSecret');
      assert.ok(parsed!.consumerSecret, 'Final config must have a consumerSecret');
    } finally {
      await harness.stop();
    }
  });
});

test('Stress Challenge 3: Session Termination & Teardown Lifecycle', async (t) => {
  const harness = await startRealServer();

  t.after(async () => {
    await harness.stop();
  });

  await t.test('DELETE /mcp cleans session and subsequent requests return 404', async () => {
    const clientCount = 6;
    const clients: McpClient[] = Array.from({ length: clientCount }, () => new McpClient(harness.baseUrl));

    // Initialize 6 sessions
    await Promise.all(clients.map((c, idx) => c.initialize(`term-client-${idx}`)));

    // Choose sessions 1, 3, 5 to delete
    const victims = [1, 3, 5];
    const survivors = [0, 2, 4];

    for (const vIdx of victims) {
      const client = clients[vIdx];
      const delRes = await client.deleteSession();
      assert.strictEqual(delRes.status, 200, `DELETE /mcp for client ${vIdx} should return 200`);

      // Subsequent POST /mcp with deleted session ID must return 404
      const postRes = await client.listTools();
      assert.strictEqual(postRes.status, 404, `Subsequent POST with terminated session ${vIdx} must return 404`);
      assert.strictEqual(postRes.jsonRpc?.error?.code, -32001, 'Error code must be -32001 (Session not found)');

      // Subsequent GET /mcp with deleted session ID must return 404
      const getRes = await client.getMcpStream();
      assert.strictEqual(getRes.status, 404, `Subsequent GET with terminated session ${vIdx} must return 404`);

      // Subsequent DELETE /mcp with deleted session ID must return 404
      const secondDelRes = await client.deleteSession();
      assert.strictEqual(secondDelRes.status, 404, `Subsequent DELETE with terminated session ${vIdx} must return 404`);
    }

    // Verify survivors are still active and functional
    for (const sIdx of survivors) {
      const client = clients[sIdx];
      const listRes = await client.listTools();
      assert.strictEqual(listRes.status, 200, `Survivor client ${sIdx} must remain active and functional`);
      const tools = (listRes.jsonRpc?.result as { tools?: unknown[] })?.tools;
      assert.strictEqual(tools?.length, 44, `Survivor client ${sIdx} must see all 44 tools`);
    }
  });

  await t.test('Double DELETE race condition: simultaneous DELETEs on same session gracefully resolve to 200 and 404', async () => {
    const client = new McpClient(harness.baseUrl);
    await client.initialize('race-client');

    const [resA, resB] = await Promise.all([
      client.deleteSession(),
      client.deleteSession(),
    ]);

    const statuses = [resA.status, resB.status].sort();
    assert.deepStrictEqual(
      statuses,
      [200, 404],
      'One DELETE should succeed (200) and the duplicate concurrent DELETE should return 404'
    );
  });

  await t.test('DELETE without Mcp-Session-Id header returns HTTP 400 Bad Request', async () => {
    const res = await fetch(`${harness.baseUrl}/mcp`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    assert.strictEqual(res.status, 400, 'DELETE without session header must return 400');
    const body = await res.json();
    assert.ok(body.error, 'Response must indicate Bad Request');
  });

  await t.test('DELETE with non-existent session ID returns HTTP 404 Not Found', async () => {
    const res = await fetch(`${harness.baseUrl}/mcp`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'mcp-session-id': '00000000-0000-0000-0000-000000000000',
      },
    });

    assert.strictEqual(res.status, 404, 'DELETE with non-existent session ID must return 404');
    const body = await res.json();
    assert.strictEqual(body.error, 'Session not found');
  });
});

test('Stress Challenge 4: Boundary & Prototype Safety on Session IDs', async (t) => {
  const harness = await startRealServer();

  t.after(async () => {
    await harness.stop();
  });

  await t.test('Path traversal session IDs return HTTP 404 without crashing or path leakage', async () => {
    const maliciousIds = [
      '../../../../etc/passwd',
      '..%2F..%2F..%2Fetc%2Fpasswd',
      '../../data/config.json',
      '/etc/shadow',
      'invalid!@#$%^&*()',
    ];

    for (const sid of maliciousIds) {
      const res = await fetch(`${harness.baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'mcp-session-id': sid,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      assert.strictEqual(res.status, 404, `Malicious session ID "${sid}" must return 404`);
      const body = await res.json();
      assert.strictEqual(body.error?.code, -32001, 'Must return JSON-RPC Session not found error');
    }
  });

  await t.test('Audit prototype property lookup vulnerability (toString, constructor, __proto__)', async () => {
    const prototypeKeys = ['toString', 'valueOf', 'constructor', 'hasOwnProperty', '__proto__'];

    for (const key of prototypeKeys) {
      const res = await fetch(`${harness.baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'mcp-session-id': key,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });

      // Record whether the server returns 404 or fails with 500
      console.log(`[Security Audit] Key: ${key} -> Status: ${res.status}`);
      if (res.status === 500) {
        console.warn(`[VULNERABILITY CONFIRMED] Session ID "${key}" triggers HTTP 500 and leaks stack trace!`);
      }
    }
  });
});

