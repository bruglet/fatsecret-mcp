import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { setupTestHarness, type TestHarnessContext } from './harness/test-server.js';
import { ConformanceServer } from './harness/conformance-server.js';

describe('Tier 1: Feature Coverage (Features 1-6)', () => {
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
  // Feature 1: Public Health Check
  // ═════════════════════════════════════════════════════════════════════
  describe('Feature 1: Public Health Check', () => {
    it('1.1: GET /health returns HTTP 200 with status "ok" without credentials', async () => {
      const res = await harness.client.getHealth();
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') || '', /application\/json/);
      const data = await res.json();
      assert.deepEqual(data, { status: 'ok' });
    });

    it('1.2: GET /health returns HTTP 200 when invalid Cf-Access-Jwt-Assertion is provided', async () => {
      const res = await harness.client.getHealth({
        'cf-access-jwt-assertion': 'invalid.token.payload',
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.deepEqual(data, { status: 'ok' });
    });

    it('1.3: GET /health returns HTTP 200 when expired Authorization Bearer is provided', async () => {
      const expiredToken = await harness.jwksServer.createExpiredToken();
      const res = await harness.client.getHealth({
        'authorization': `Bearer ${expiredToken}`,
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.deepEqual(data, { status: 'ok' });
    });

    it('1.4: HEAD /health returns HTTP 200 with empty body', async () => {
      const res = await harness.client.headHealth();
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.equal(text, '');
    });

    it('1.5: GET /health with arbitrary query string parameters returns HTTP 200', async () => {
      const res = await harness.client.getHealth({}, '/health?check=liveness&format=json&t=12345');
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.deepEqual(data, { status: 'ok' });
    });

    it('1.6: GET /health with custom Accept headers returns JSON status ok', async () => {
      const res = await harness.client.getHealth({
        'Accept': 'application/json, text/plain, */*',
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, 'ok');
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  // Feature 2: Streamable HTTP Transport at /mcp
  // ═════════════════════════════════════════════════════════════════════
  describe('Feature 2: Streamable HTTP Transport at /mcp', () => {
    let sessionToken: string;

    before(async () => {
      sessionToken = await harness.jwksServer.createValidToken();
      harness.client.setToken(sessionToken);
    });

    it('2.1: POST /mcp initialize request returns 200 with mcp-session-id and serverInfo', async () => {
      const initRes = await harness.client.initialize('test-client-suite', '1.0.0');
      assert.equal(initRes.status, 200);
      assert.ok(initRes.sessionId, 'Response must include mcp-session-id header');
      assert.ok(initRes.sessionId!.length > 10, 'Session ID must be non-empty');
      assert.ok(initRes.jsonRpc, 'Must return JSON-RPC payload');
      assert.equal(initRes.jsonRpc?.id, 1);
      const result = initRes.jsonRpc?.result as { serverInfo?: { name: string } };
      assert.ok(result?.serverInfo?.name, 'Must include serverInfo');
    });

    it('2.2: POST /mcp with notifications/initialized returns HTTP 202 Accepted', async () => {
      const notifRes = await harness.client.sendNotification('notifications/initialized');
      assert.equal(notifRes.status, 202);
    });

    it('2.3: POST /mcp with tools/list returns available tools array', async () => {
      const listRes = await harness.client.listTools(2);
      assert.equal(listRes.status, 200);
      assert.ok(listRes.jsonRpc);
      assert.equal(listRes.jsonRpc?.id, 2);
      const result = listRes.jsonRpc?.result as { tools?: Array<{ name: string }> };
      assert.ok(Array.isArray(result?.tools), 'Tools result must be an array');
      const toolNames = result.tools.map((t) => t.name);
      assert.ok(toolNames.includes('get_food_entries'), 'Should expose get_food_entries tool');
    });

    it('2.4: POST /mcp with tools/call executes tool successfully', async () => {
      const callRes = await harness.client.callTool('get_food_entries', { date: '2026-09-03' }, 3);
      assert.equal(callRes.status, 200);
      assert.ok(callRes.jsonRpc);
      assert.equal(callRes.jsonRpc?.id, 3);
      const result = callRes.jsonRpc?.result as { content?: Array<{ type: string; text: string }> };
      assert.ok(Array.isArray(result?.content));
      assert.equal(result.content[0].type, 'text');
    });

    it('2.5: GET /mcp with active session returns text/event-stream SSE connection', async () => {
      const sseRes = await harness.client.getMcpStream();
      assert.equal(sseRes.status, 200);
      assert.match(sseRes.headers.get('content-type') || '', /text\/event-stream/);
      if (sseRes.body) {
        await sseRes.body.cancel();
      }
    });

    it('2.6: DELETE /mcp terminates session and subsequent calls return 404', async () => {
      const savedSessionId = harness.client.sessionId;
      assert.ok(savedSessionId);

      const delRes = await harness.client.deleteSession();
      assert.equal(delRes.status, 200);

      const postRes = await harness.client.listTools(4);
      assert.equal(postRes.status, 404);
      harness.client.sessionId = null;
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  // Feature 3: Config & Token Storage Override
  // ═════════════════════════════════════════════════════════════════════
  describe('Feature 3: Config & Token Storage Override', () => {
    it('3.1: Storage directory defaults to FATSECRET_CONFIG_DIR environment variable', () => {
      const server = new ConformanceServer({
        teamDomain: harness.jwksServer.teamDomain,
        jwksUrl: harness.jwksServer.getJwksUrl(),
        audTag: harness.jwksServer.audTag,
      });
      assert.equal(server.getConfigDir(), harness.configDir);
      assert.equal(server.getConfigPath(), join(harness.configDir, 'config.json'));
    });

    it('3.2: Non-existent config file (ENOENT) loads empty config gracefully without error', () => {
      const missingDir = join(harness.configDir, 'sub-dir-missing');
      const server = new ConformanceServer({
        configDir: missingDir,
        teamDomain: harness.jwksServer.teamDomain,
        jwksUrl: harness.jwksServer.getJwksUrl(),
        audTag: harness.jwksServer.audTag,
      });
      const config = server.loadConfig();
      assert.deepEqual(config, {});
    });

    it('3.3: Storage creates parent directory recursively when writing config', () => {
      const deepDir = join(harness.configDir, 'nested', 'deep', 'config');
      const server = new ConformanceServer({
        configDir: deepDir,
        teamDomain: harness.jwksServer.teamDomain,
        jwksUrl: harness.jwksServer.getJwksUrl(),
        audTag: harness.jwksServer.audTag,
      });

      server.saveConfig({ clientId: 'id-test-123', clientSecret: 'sec-456' });
      const loaded = server.loadConfig();
      assert.equal(loaded.clientId, 'id-test-123');
      assert.equal(loaded.clientSecret, 'sec-456');
    });

    it('3.4: Atomic read/write accurately stores and retrieves OAuth credentials', () => {
      const server = new ConformanceServer({
        configDir: harness.configDir,
        teamDomain: harness.jwksServer.teamDomain,
        jwksUrl: harness.jwksServer.getJwksUrl(),
        audTag: harness.jwksServer.audTag,
      });

      const creds = {
        accessToken: 'oauth-token-xyz-789',
        accessTokenSecret: 'oauth-secret-abc-456',
        consumerSecret: 'consumer-sec-999',
      };
      server.saveConfig(creds);

      const rawFile = readFileSync(server.getConfigPath(), 'utf8');
      assert.doesNotThrow(() => JSON.parse(rawFile));

      const loaded = server.loadConfig();
      assert.deepEqual(loaded, creds);
    });

    it('3.5: Modifying existing config preserves unrelated keys', () => {
      const server = new ConformanceServer({
        configDir: harness.configDir,
        teamDomain: harness.jwksServer.teamDomain,
        jwksUrl: harness.jwksServer.getJwksUrl(),
        audTag: harness.jwksServer.audTag,
      });

      server.saveConfig({ clientId: 'keep-me', accessToken: 'old-token' });
      const current = server.loadConfig();
      server.saveConfig({ ...current, accessToken: 'new-token' });

      const updated = server.loadConfig();
      assert.equal(updated.clientId, 'keep-me');
      assert.equal(updated.accessToken, 'new-token');
    });

    it('3.6: Default fallback directory is /data when FATSECRET_CONFIG_DIR is unset', () => {
      const oldEnv = process.env.FATSECRET_CONFIG_DIR;
      delete process.env.FATSECRET_CONFIG_DIR;
      try {
        const server = new ConformanceServer({
          teamDomain: harness.jwksServer.teamDomain,
          jwksUrl: harness.jwksServer.getJwksUrl(),
          audTag: harness.jwksServer.audTag,
        });
        assert.equal(server.getConfigDir(), '/data');
      } finally {
        process.env.FATSECRET_CONFIG_DIR = oldEnv;
      }
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  // Feature 4: Cloudflare Access Header Extraction
  // ═════════════════════════════════════════════════════════════════════
  describe('Feature 4: Cloudflare Access Header Extraction', () => {
    it('4.1: Successfully extracts and verifies token from Cf-Access-Jwt-Assertion header', async () => {
      const client = harness.client;
      client.sessionId = null;
      client.setToken(validToken, 'Cf-Access-Jwt-Assertion');

      const res = await client.initialize('client-f4-cf', '1.0');
      assert.equal(res.status, 200);
      assert.ok(res.sessionId);
      await client.deleteSession();
    });

    it('4.2: Successfully extracts and verifies token from Authorization: Bearer header', async () => {
      const client = harness.client;
      client.sessionId = null;
      client.setToken(validToken, 'Authorization');

      const res = await client.initialize('client-f4-bearer', '1.0');
      assert.equal(res.status, 200);
      assert.ok(res.sessionId);
      await client.deleteSession();
    });

    it('4.3: Header precedence: Cf-Access-Jwt-Assertion takes precedence over Authorization', async () => {
      const invalidBearer = 'completely.invalid.bearer-token';
      const client = harness.client;
      client.sessionId = null;

      // Both headers sent: Cf-Access-Jwt-Assertion is valid, Authorization is garbage
      const res = await client.sendJsonRpc(
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'prec', version: '1.0' } },
        },
        {
          headers: {
            'cf-access-jwt-assertion': validToken,
            'authorization': `Bearer ${invalidBearer}`,
          },
        }
      );
      assert.equal(res.status, 200, 'Valid primary Cf-Access-Jwt-Assertion must succeed despite bad Bearer header');
      if (res.sessionId) {
        client.sessionId = res.sessionId;
        await client.deleteSession();
      }
    });

    it('4.4: Case-insensitive header name extraction (CF-ACCESS-JWT-ASSERTION)', async () => {
      const client = harness.client;
      client.sessionId = null;

      const res = await client.sendJsonRpc(
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'case', version: '1.0' } },
        },
        {
          headers: {
            'CF-ACCESS-JWT-ASSERTION': validToken,
          },
        }
      );
      assert.equal(res.status, 200);
      if (res.sessionId) {
        client.sessionId = res.sessionId;
        await client.deleteSession();
      }
    });

    it('4.5: Non-Bearer authorization scheme (e.g. Basic) is rejected with 401', async () => {
      const client = harness.client;
      client.sessionId = null;

      const res = await client.sendJsonRpc(
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'basic', version: '1.0' } },
        },
        {
          headers: {
            'authorization': 'Basic dXNlcm5hbWU6cGFzc3dvcmQ=',
          },
        }
      );
      assert.equal(res.status, 401);
    });

    it('4.6: Bearer token with extra leading whitespace is extracted cleanly', async () => {
      const client = harness.client;
      client.sessionId = null;

      const res = await client.sendJsonRpc(
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'space', version: '1.0' } },
        },
        {
          headers: {
            'authorization': `Bearer    ${validToken}`,
          },
        }
      );
      assert.equal(res.status, 200);
      if (res.sessionId) {
        client.sessionId = res.sessionId;
        await client.deleteSession();
      }
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  // Feature 5: Cloudflare Access JWKS & Claims Validation
  // ═════════════════════════════════════════════════════════════════════
  describe('Feature 5: Cloudflare Access JWKS & Claims Validation', () => {
    it('5.1: Validates cryptographic signature against remote JWKS RS256 public key', async () => {
      const client = harness.client;
      client.sessionId = null;
      client.setToken(validToken);

      const res = await client.initialize('client-f5-sig', '1.0');
      assert.equal(res.status, 200);
      await client.deleteSession();
    });

    it('5.2: Validates matching issuer (iss) matches configured team domain', async () => {
      const client = harness.client;
      client.sessionId = null;
      const wrongIssToken = await harness.jwksServer.createWrongIssuerToken();
      client.setToken(wrongIssToken);

      const res = await client.initialize('client-wrong-iss', '1.0');
      assert.equal(res.status, 401);
    });

    it('5.3: Validates matching audience (aud) matches configured CF_ACCESS_AUD tag', async () => {
      const client = harness.client;
      client.sessionId = null;
      const wrongAudToken = await harness.jwksServer.createWrongAudToken();
      client.setToken(wrongAudToken);

      const res = await client.initialize('client-wrong-aud', '1.0');
      assert.equal(res.status, 401);
    });

    it('5.4: Validates array aud claims containing the expected AUD tag', async () => {
      const client = harness.client;
      client.sessionId = null;
      const arrayAudToken = await harness.jwksServer.createArrayAudToken();
      client.setToken(arrayAudToken);

      const res = await client.initialize('client-array-aud', '1.0');
      assert.equal(res.status, 200);
      await client.deleteSession();
    });

    it('5.5: Supports key rotation: token signed with rotated secondary key is accepted', async () => {
      const client = harness.client;
      client.sessionId = null;
      const rotatedToken = await harness.jwksServer.createRotatedToken();
      client.setToken(rotatedToken);

      const res = await client.initialize('client-rotated', '1.0');
      assert.equal(res.status, 200);
      await client.deleteSession();
    });

    it('5.6: Rejects tokens with future not-before (nbf) claim', async () => {
      const client = harness.client;
      client.sessionId = null;
      const futureToken = await harness.jwksServer.createNotBeforeToken();
      client.setToken(futureToken);

      const res = await client.initialize('client-future', '1.0');
      assert.equal(res.status, 401);
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  // Feature 6: 401 Unauthorized Rejection
  // ═════════════════════════════════════════════════════════════════════
  describe('Feature 6: 401 Unauthorized Rejection', () => {
    it('6.1: Requests to /mcp without authentication header return HTTP 401', async () => {
      const client = harness.client;
      client.sessionId = null;
      client.setToken(null);

      const res = await client.initialize('unauthed', '1.0');
      assert.equal(res.status, 401);
    });

    it('6.2: Requests with empty string token header return HTTP 401', async () => {
      const client = harness.client;
      client.sessionId = null;

      const res = await client.sendJsonRpc(
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { headers: { 'cf-access-jwt-assertion': '' } }
      );
      assert.equal(res.status, 401);
    });

    it('6.3: Requests with malformed JWT string return HTTP 401', async () => {
      const client = harness.client;
      client.sessionId = null;
      client.setToken('not.a-valid-jwt.token.string');

      const res = await client.initialize('malformed', '1.0');
      assert.equal(res.status, 401);
    });

    it('6.4: Requests with token signed by untrusted key (kid not in JWKS) return HTTP 401', async () => {
      const client = harness.client;
      client.sessionId = null;
      const untrustedToken = await harness.jwksServer.createUntrustedKeyToken();
      client.setToken(untrustedToken);

      const res = await client.initialize('untrusted-key', '1.0');
      assert.equal(res.status, 401);
    });

    it('6.5: Requests with tampered cryptographic signature return HTTP 401', async () => {
      const client = harness.client;
      client.sessionId = null;
      const tamperedToken = await harness.jwksServer.createTamperedToken();
      client.setToken(tamperedToken);

      const res = await client.initialize('tampered', '1.0');
      assert.equal(res.status, 401);
    });

    it('6.6: Rejection response body contains standard JSON error format', async () => {
      const client = harness.client;
      client.sessionId = null;
      client.setToken(null);

      const res = await client.initialize('format-test', '1.0');
      assert.equal(res.status, 401);
      assert.match(res.headers.get('content-type') || '', /application\/json/);
      const data = JSON.parse(res.rawBody);
      assert.equal(data.error, 'Unauthorized');
      assert.ok(typeof data.message === 'string' && data.message.length > 0);
    });
  });
});
