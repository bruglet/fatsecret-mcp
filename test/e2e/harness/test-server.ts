import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { MockJwksServer } from './mock-jwks.js';
import { ConformanceServer } from './conformance-server.js';
import { McpClient } from './mcp-client.js';

export interface TestHarnessContext {
  jwksServer: MockJwksServer;
  serverBaseUrl: string;
  configDir: string;
  client: McpClient;
  cleanup: () => Promise<void>;
  realProcess?: ChildProcess;
}

export async function setupTestHarness(options: {
  useRealServer?: boolean;
  serverUrl?: string;
  customConfigDir?: string;
} = {}): Promise<TestHarnessContext> {
  const jwksServer = new MockJwksServer();
  await jwksServer.start();

  const tempDir = options.customConfigDir || mkdtempSync(join(tmpdir(), 'fatsecret-e2e-'));
  process.env.FATSECRET_CONFIG_DIR = tempDir;
  process.env.CF_ACCESS_TEAM_DOMAIN = jwksServer.teamDomain;
  process.env.CF_ACCESS_AUD = jwksServer.audTag;

  let serverBaseUrl = options.serverUrl || process.env.MCP_SERVER_URL;
  let conformanceServer: ConformanceServer | null = null;
  let realProcess: ChildProcess | undefined;

  if (serverBaseUrl) {
    // External server already running
  } else if (options.useRealServer || process.env.USE_REAL_SERVER === '1') {
    // Attempt to spawn real server
    const port = Math.floor(Math.random() * 10000) + 30000;
    serverBaseUrl = `http://127.0.0.1:${port}`;
    realProcess = spawn('node', ['--import', 'tsx', 'src/index.ts'], {
      env: {
        ...process.env,
        PORT: String(port),
        FATSECRET_CONFIG_DIR: tempDir,
        CF_ACCESS_TEAM_DOMAIN: jwksServer.teamDomain,
        CF_ACCESS_AUD: jwksServer.audTag,
      },
      stdio: 'pipe',
    });

    // Wait for server port to be ready
    let attempts = 0;
    while (attempts < 20) {
      try {
        const res = await fetch(`${serverBaseUrl}/health`);
        if (res.ok) break;
      } catch {
        // wait
      }
      await new Promise((r) => setTimeout(r, 200));
      attempts++;
    }
  } else {
    // Default to conformance server adhering strictly to PROJECT.md interface contracts
    conformanceServer = new ConformanceServer({
      configDir: tempDir,
      teamDomain: jwksServer.teamDomain,
      jwksUrl: jwksServer.getJwksUrl(),
      audTag: jwksServer.audTag,
    });
    serverBaseUrl = await conformanceServer.start();
  }

  const client = new McpClient(serverBaseUrl);

  const cleanup = async (): Promise<void> => {
    if (conformanceServer) {
      await conformanceServer.stop();
    }
    if (realProcess) {
      realProcess.kill('SIGTERM');
    }
    await jwksServer.stop();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  };

  return {
    jwksServer,
    serverBaseUrl,
    configDir: tempDir,
    client,
    cleanup,
    realProcess,
  };
}
