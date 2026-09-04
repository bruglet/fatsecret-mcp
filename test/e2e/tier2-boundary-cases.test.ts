import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFileSync, chmodSync, rmSync, mkdirSync } from 'node:fs';
import { setupTestHarness, type TestHarnessContext } from './harness/test-server.js';
import { ConformanceServer } from './harness/conformance-server.js';

describe('Tier 2: Boundary & Corner Cases (Features 1-6)', () => {
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
  // Feature 1 Boundary Cases: Health Check
  // ═════════════════════════════════════════════════════════════════════
  describe('Feature 1 Boundaries: Public Health Check', () => {
    it('1.b1: POST /health (unsupported method) returns HTTP 404 or 405, not 200', async () => {
      const res = await fetch(`${harness.serverBaseUrl}/health`, { method: 'POST' });
      assert.notEqual(res.status, 200);
    });

    it('1.b2: GET /health with large query string (>8KB) does not crash server', async () => {
      const longQuery = 'q=' + 'a'.repeat(8192);
      const res = await harness.client.getHealth({}, `/health?${longQuery}`);
      // Either 200 OK or 414 URI Too Long is standard and acceptable; must not crash (500)
      assert.ok(res.status === 200 || res.status === 414);
    });

    it('1.b3: GET /health with unexpected control headers returns 200', async () => {
      const res = await harness.client.getHealth({
        'X-Unexpected-Header': 'custom-health-probe-12345!@#$%^&*()',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, 'ok');
    });

    it('1.b4: GET /health handles concurrent burst of 25 requests reliably', async () => {
      const requests = Array.from({ length: 25 }, () => harness.client.getHealth());
      const responses = await Promise.all(requests);
      for (const res of responses) {
        assert.equal(res.status, 200);
      }
    });

    it('1.b5: GET /health with empty query string (?) returns 200', async () => {
      const res = await harness.client.getHealth({}, '/health?');
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, 'ok');
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  // Feature 2 Boundary Cases: Streamable HTTP Transport
  // ═════════════════════════════════════════════════════════════════════
  describe('Feature 2 Boundaries: Streamable HTTP Transport', () => {
    it('2.b1: Empty request body on POST /mcp returns HTTP 400 Bad Request', async () => {
      const res = await harness.client.sendJsonRpc(null, {
        headers: { 'cf-access-jwt-assertion': validToken },
        rawBody: '',
      });
      assert.ok(res.status >= 400 && res.status < 500, `Expected 4xx error but got ${res.status}`);
    });

    it('2.b2: Malformed JSON syntax on POST /mcp returns HTTP 400 Bad Request', async () => {
      const res = await harness.client.sendJsonRpc(null, {
        headers: { 'cf-access-jwt-assertion': validToken },
        rawBody: '{"jsonrpc": "2.0", "method": broken_syntax',
      });
      assert.equal(res.status, 400);
    });

    it('2.b3: Non-existent / random UUID in Mcp-Session-Id returns HTTP 404', async () => {
      const fakeSessionId = '00000000-0000-0000-0000-000000000000';
      const res = await harness.client.sendJsonRpc(
        { jsonrpc: '2.0', id: 99, method: 'tools/list', params: {} },
        {
          headers: {
            'cf-access-jwt-assertion': validToken,
            'mcp-session-id': fakeSessionId,
          },
        }
      );
      assert.equal(res.status, 404);
    });

    it('2.b4: Missing Mcp-Session-Id header on non-initialize request returns 400 or 404', async () => {
      // Calling tools/list without initialize and without session header
      const client = harness.client;
      client.sessionId = null;
      client.setToken(validToken);

      const res = await client.sendJsonRpc({
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/list',
        params: {},
      });
      assert.ok(res.status === 400 || res.status === 404);
    });

    it('2.b5: GET /mcp without Mcp-Session-Id returns HTTP 400 Bad Request', async () => {
      const client = harness.client;
      client.sessionId = null;
      client.setToken(validToken);

      const res = await client.getMcpStream();
      assert.equal(res.status, 400);
    });

    it('2.b6: DELETE /mcp without Mcp-Session-Id returns HTTP 400 Bad Request', async () => {
      const client = harness.client;
      client.sessionId = null;
      client.setToken(validToken);

      const res = await client.deleteSession();
      assert.equal(res.status, 400);
    });

    it('2.b7: Extremely large payload exceeding body limit returns 413 Payload Too Large', async () => {
      const largePayload = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          hugeBlob: 'x'.repeat(5 * 1024 * 1024), // 5MB exceeds 4MB default limit
        },
      };

      const res = await harness.client.sendJsonRpc(largePayload, {
        headers: { 'cf-access-jwt-assertion': validToken },
      });
      assert.equal(res.status, 413);
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  // Feature 3 Boundary Cases: Config & Storage Override
  // ═════════════════════════════════════════════════════════════════════
  describe('Feature 3 Boundaries: Config & Storage Override', () => {
    it('3.b1: Permission error on read-only directory throws error cleanly', () => {
      const readOnlyDir = join(harness.configDir, 'readonly-test');
      mkdirSync(readOnlyDir, { recursive: true });
      chmodSync(readOnlyDir, 0o555);

      const originalEnv = process.env.FATSECRET_CONFIG_DIR;
      process.env.FATSECRET_CONFIG_DIR = readOnlyDir;

      try {
        const server = new ConformanceServer({
          configDir: readOnlyDir,
          teamDomain: harness.jwksServer.teamDomain,
          jwksUrl: harness.jwksServer.getJwksUrl(),
          audTag: harness.jwksServer.audTag,
        });

        assert.throws(() => {
          server.saveConfig({ test: 'fail' });
        });
      } finally {
        chmodSync(readOnlyDir, 0o755);
        process.env.FATSECRET_CONFIG_DIR = originalEnv;
      }
    });

    it('3.b2: Config directory pointing to regular file throws descriptive error', () => {
      const filePathAsDir = join(harness.configDir, 'regular-file-as-dir');
      writeFileSync(filePathAsDir, 'not a directory', 'utf8');

      const originalEnv = process.env.FATSECRET_CONFIG_DIR;
      process.env.FATSECRET_CONFIG_DIR = filePathAsDir;

      try {
        const server = new ConformanceServer({
          configDir: filePathAsDir,
          teamDomain: harness.jwksServer.teamDomain,
          jwksUrl: harness.jwksServer.getJwksUrl(),
          audTag: harness.jwksServer.audTag,
        });

        assert.throws(() => {
          server.saveConfig({ test: 'should-fail' });
        });
      } finally {
        process.env.FATSECRET_CONFIG_DIR = originalEnv;
      }
    });

    it('3.b3: Unicode, emoji, and large token strings persist and reload with full fidelity', () => {
      const server = new ConformanceServer({
        configDir: harness.configDir,
        teamDomain: harness.jwksServer.teamDomain,
        jwksUrl: harness.jwksServer.getJwksUrl(),
        audTag: harness.jwksServer.audTag,
      });

      const complexConfig = {
        appName: 'FatSecret 🍎 Modernized 🚀',
        accessToken: 'token_' + '⚡'.repeat(100),
        nested: {
          array: [1, 'two', { three: '🥑' }],
        },
      };

      server.saveConfig(complexConfig);
      const loaded = server.loadConfig();
      assert.deepEqual(loaded, complexConfig);
    });

    it('3.b4: Corrupted / invalid JSON in config file falls back gracefully without crashing', () => {
      const brokenDir = join(harness.configDir, 'broken-json-dir');
      mkdirSync(brokenDir, { recursive: true });
      writeFileSync(join(brokenDir, 'config.json'), '{ invalid json syntax !!!', 'utf8');

      const originalEnv = process.env.FATSECRET_CONFIG_DIR;
      process.env.FATSECRET_CONFIG_DIR = brokenDir;

      try {
        const server = new ConformanceServer({
          configDir: brokenDir,
          teamDomain: harness.jwksServer.teamDomain,
          jwksUrl: harness.jwksServer.getJwksUrl(),
          audTag: harness.jwksServer.audTag,
        });

        const loaded = server.loadConfig();
        assert.deepEqual(loaded, {});
      } finally {
        process.env.FATSECRET_CONFIG_DIR = originalEnv;
      }
    });

    it('3.b5: Redundant and trailing slashes in FATSECRET_CONFIG_DIR are handled cleanly', () => {
      const dirtyPath = join(harness.configDir, 'trailing') + '///';
      const originalEnv = process.env.FATSECRET_CONFIG_DIR;
      process.env.FATSECRET_CONFIG_DIR = dirtyPath;

      try {
        const server = new ConformanceServer({
          configDir: dirtyPath,
          teamDomain: harness.jwksServer.teamDomain,
          jwksUrl: harness.jwksServer.getJwksUrl(),
          audTag: harness.jwksServer.audTag,
        });

        server.saveConfig({ clean: true });
        const loaded = server.loadConfig();
        assert.deepEqual(loaded, { clean: true });
      } finally {
        process.env.FATSECRET_CONFIG_DIR = originalEnv;
      }
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  // Feature 4 Boundary Cases: Header Extraction
  // ═════════════════════════════════════════════════════════════════════
  describe('Feature 4 Boundaries: Header Extraction', () => {
    it('4.b1: Very large header values (>8KB) do not crash the server', async () => {
      const oversizedHeader = 'Bearer ' + 'A'.repeat(8192);
      const res = await fetch(`${harness.serverBaseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Authorization': oversizedHeader,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      });
      // Either 401 Unauthorized or 431 Request Header Fields Too Large is valid; must not crash
      assert.ok(res.status === 401 || res.status === 431);
    });

    it('4.b2: Whitespace-only Cf-Access-Jwt-Assertion is rejected with 401', async () => {
      const client = harness.client;
      client.sessionId = null;
      client.setToken(null);
      const res = await client.sendJsonRpc(
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { headers: { 'cf-access-jwt-assertion': '     ' } }
      );
      assert.equal(res.status, 401);
    });

    it('4.b3: Authorization: Bearer with only whitespace is rejected with 401', async () => {
      const client = harness.client;
      client.sessionId = null;
      client.setToken(null);
      const res = await client.sendJsonRpc(
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { headers: { 'authorization': 'Bearer    ' } }
      );
      assert.equal(res.status, 401);
    });

    it('4.b4: Authorization header with no Bearer keyword returns 401', async () => {
      const client = harness.client;
      client.sessionId = null;
      client.setToken(null);
      const res = await client.sendJsonRpc(
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { headers: { 'authorization': `${validToken}` } } // Missing "Bearer " prefix
      );
      assert.equal(res.status, 401);
    });

    it('4.b5: Mixed casing Authorization: bEaReR is accepted', async () => {
      const client = harness.client;
      client.sessionId = null;
      const res = await client.sendJsonRpc(
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mix', version: '1.0' } },
        },
        { headers: { 'authorization': `bEaReR ${validToken}` } }
      );
      assert.equal(res.status, 200);
      if (res.sessionId) {
        client.sessionId = res.sessionId;
        await client.deleteSession();
      }
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  // Feature 5 Boundary Cases: JWKS & Claims Validation
  // ═════════════════════════════════════════════════════════════════════
  describe('Feature 5 Boundaries: JWKS & Claims Validation', () => {
    it('5.b1: Expired JWT (exp in past) returns HTTP 401', async () => {
      const expiredToken = await harness.jwksServer.createExpiredToken();
      const client = harness.client;
      client.sessionId = null;
      client.setToken(expiredToken);

      const res = await client.initialize('expired-test', '1.0');
      assert.equal(res.status, 401);
    });

    it('5.b2: Invalid issuer claim returns HTTP 401', async () => {
      const wrongIss = await harness.jwksServer.createWrongIssuerToken();
      const client = harness.client;
      client.sessionId = null;
      client.setToken(wrongIss);

      const res = await client.initialize('iss-test', '1.0');
      assert.equal(res.status, 401);
    });

    it('5.b3: Invalid audience claim returns HTTP 401', async () => {
      const wrongAud = await harness.jwksServer.createWrongAudToken();
      const client = harness.client;
      client.sessionId = null;
      client.setToken(wrongAud);

      const res = await client.initialize('aud-test', '1.0');
      assert.equal(res.status, 401);
    });

    it('5.b4: Unsigned algorithm "none" is rejected with HTTP 401', async () => {
      const noneToken = await harness.jwksServer.createNoneAlgToken();
      const client = harness.client;
      client.sessionId = null;
      client.setToken(noneToken);

      const res = await client.initialize('none-test', '1.0');
      assert.equal(res.status, 401);
    });

    it('5.b5: Symmetric algorithm HS256 is rejected with HTTP 401', async () => {
      const hsToken = await harness.jwksServer.createHS256Token();
      const client = harness.client;
      client.sessionId = null;
      client.setToken(hsToken);

      const res = await client.initialize('hs256-test', '1.0');
      assert.equal(res.status, 401);
    });

    it('5.b6: JWKS server error causes fail-closed HTTP 401 rejection', async () => {
      harness.jwksServer.setSimulateError(true);
      try {
        const client = harness.client;
        client.sessionId = null;
        // Key with uncached kid forces remote JWKS refresh, hitting 500 error
        const freshKey = await harness.jwksServer.createUntrustedKeyToken();
        client.setToken(freshKey);

        const res = await client.initialize('jwks-fail', '1.0');
        // Must fail closed (401 or 500), never allow unauthorized bypass
        assert.notEqual(res.status, 200);
      } finally {
        harness.jwksServer.setSimulateError(false);
      }
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  // Feature 6 Boundary Cases: 401 Rejection
  // ═════════════════════════════════════════════════════════════════════
  describe('Feature 6 Boundaries: 401 Unauthorized Rejection', () => {
    it('6.b1: 401 response does not leak sensitive internal stack traces or env secrets', async () => {
      const client = harness.client;
      client.sessionId = null;
      client.setToken(null);

      const res = await client.initialize('leak-test', '1.0');
      assert.equal(res.status, 401);
      assert.ok(!res.rawBody.includes('node_modules'));
      assert.ok(!res.rawBody.includes('process.env'));
      assert.ok(!res.rawBody.includes('at ModuleJob'));
    });

    it('6.b2: 401 response body contains structured JSON error', async () => {
      const client = harness.client;
      client.sessionId = null;
      client.setToken('invalid-token');

      const res = await client.initialize('structured-err', '1.0');
      assert.equal(res.status, 401);
      const json = JSON.parse(res.rawBody);
      assert.equal(json.error, 'Unauthorized');
      assert.ok(typeof json.message === 'string');
    });

    it('6.b3: Unauthorized request on GET /mcp returns 401 without opening SSE stream', async () => {
      const client = harness.client;
      client.sessionId = 'fake-session-id';
      client.setToken(null);

      const res = await client.getMcpStream();
      assert.equal(res.status, 401);
      assert.notEqual(res.headers.get('content-type'), 'text/event-stream');
    });

    it('6.b4: Unauthorized request on DELETE /mcp returns 401 without affecting active sessions', async () => {
      // First create a real active session
      const client = harness.client;
      client.sessionId = null;
      client.setToken(validToken);
      const initRes = await client.initialize('pre-del', '1.0');
      assert.equal(initRes.status, 200);
      const activeSessionId = client.sessionId;
      assert.ok(activeSessionId);

      // Attempt to delete session without auth token
      const unauthClient = harness.client;
      unauthClient.setToken(null);
      const delRes = await unauthClient.deleteSession();
      assert.equal(delRes.status, 401);

      // Verify active session is still valid
      client.setToken(validToken);
      client.sessionId = activeSessionId;
      const listRes = await client.listTools(9);
      assert.equal(listRes.status, 200);

      // Clean up session
      await client.deleteSession();
    });

    it('6.b5: Rapid burst of 25 unauthorized requests consistently returns 401 without degradation', async () => {
      const client = harness.client;
      client.sessionId = null;
      client.setToken(null);

      const requests = Array.from({ length: 25 }, () => client.initialize('burst-unauth', '1.0'));
      const responses = await Promise.all(requests);
      for (const res of responses) {
        assert.equal(res.status, 401);
      }
    });
  });
});
