import http, { type Server } from 'node:http';
import { join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import * as jose from 'jose';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

export interface ConformanceServerOptions {
  port?: number;
  configDir?: string;
  teamDomain: string;
  jwksUrl: string;
  audTag: string;
}

export interface Config {
  clientId?: string;
  clientSecret?: string;
  consumerSecret?: string;
  accessToken?: string;
  accessTokenSecret?: string;
  [key: string]: unknown;
}

export class ConformanceServer {
  public app: express.Express;
  public server: Server | null = null;
  public port = 0;
  public configDir: string;
  public teamDomain: string;
  public jwksUrl: string;
  public audTag: string;

  private transports = new Map<string, StreamableHTTPServerTransport>();
  private jwks: jose.JWTVerifyGetKey;

  constructor(options: ConformanceServerOptions) {
    this.configDir = options.configDir || process.env.FATSECRET_CONFIG_DIR || '/data';
    this.teamDomain = options.teamDomain;
    this.jwksUrl = options.jwksUrl;
    this.audTag = options.audTag;
    this.port = options.port || 0;

    this.jwks = jose.createRemoteJWKSet(new URL(this.jwksUrl));
    this.app = express();
    this.setupRoutes();
  }

  // ── Config Storage API matching PROJECT.md § Storage Contract ──

  public getConfigDir(): string {
    return process.env.FATSECRET_CONFIG_DIR || this.configDir;
  }

  public getConfigPath(): string {
    return join(this.getConfigDir(), 'config.json');
  }

  public loadConfig(): Config {
    const configPath = this.getConfigPath();
    try {
      if (!existsSync(configPath)) {
        return {};
      }
      const data = readFileSync(configPath, 'utf8');
      return JSON.parse(data) as Config;
    } catch (err: unknown) {
      const error = err as { code?: string };
      if (error.code === 'ENOENT') {
        return {};
      }
      return {};
    }
  }

  public saveConfig(config: Config): void {
    const dir = this.getConfigDir();
    mkdirSync(dir, { recursive: true });
    const configPath = this.getConfigPath();
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  }

  // ── Auth Middleware matching PROJECT.md § Security Middleware ──

  private authMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    let token: string | undefined;

    const cfHeader = req.headers['cf-access-jwt-assertion'];
    const authHeader = req.headers['authorization'];

    if (typeof cfHeader === 'string' && cfHeader.trim().length > 0) {
      token = cfHeader.trim();
    } else if (typeof authHeader === 'string') {
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (match && match[1].trim().length > 0) {
        token = match[1].trim();
      }
    }

    if (!token) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or empty Cloudflare Access JWT assertion',
      });
      return;
    }

    try {
      const { payload } = await jose.jwtVerify(token, this.jwks, {
        issuer: this.teamDomain,
        audience: this.audTag,
        algorithms: ['RS256'],
      });

      (req as Request & { user?: unknown }).user = payload;
      next();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Invalid token';
      res.status(401).json({
        error: 'Unauthorized',
        message,
      });
    }
  };

  private createMcpServerInstance(): McpServer {
    const server = new McpServer({
      name: 'fatsecret-mcp',
      version: '0.0.9',
    });

    server.tool(
      'get_food_entries',
      'Retrieves food entries for a specific date',
      {
        date: z.string().describe('Date in YYYY-MM-DD format'),
        food_entry_id: z.number().optional().describe('Specific food entry ID'),
      },
      async (args) => {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'success',
                date: args.date,
                entries: [],
              }),
            },
          ],
        };
      }
    );

    server.tool(
      'search_food',
      'Searches for food items',
      {
        search_expression: z.string().describe('Search query for food'),
        page_number: z.number().optional(),
        max_results: z.number().optional(),
      },
      async (args) => {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'success',
                query: args.search_expression,
                results: [],
              }),
            },
          ],
        };
      }
    );

    server.tool(
      'save_auth_credentials',
      'Persists OAuth credentials to config storage',
      {
        accessToken: z.string(),
        accessTokenSecret: z.string(),
      },
      async (args) => {
        const current = this.loadConfig();
        const updated = {
          ...current,
          accessToken: args.accessToken,
          accessTokenSecret: args.accessTokenSecret,
        };
        this.saveConfig(updated);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ status: 'saved', path: this.getConfigPath() }),
            },
          ],
        };
      }
    );

    return server;
  }

  private setupRoutes(): void {
    // Body parsing middleware
    this.app.use(express.json({ limit: '4mb' }));

    // Feature 1: Public Health Check
    this.app.get('/health', (_req: Request, res: Response) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.status(200).json({ status: 'ok' });
    });

    this.app.head('/health', (_req: Request, res: Response) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.status(200).end();
    });

    // Feature 2: Streamable HTTP Transport at /mcp protected by Cloudflare Access Auth
    this.app.post('/mcp', this.authMiddleware, async (req: Request, res: Response) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      let transport: StreamableHTTPServerTransport;
      if (sessionId && this.transports.has(sessionId)) {
        transport = this.transports.get(sessionId)!;
      } else if (!sessionId) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessionclosed: (id) => {
            this.transports.delete(id);
          },
        });

        const mcpServer = this.createMcpServerInstance();
        await mcpServer.connect(transport);
      } else {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      await transport.handleRequest(req, res, req.body);

      if (transport.sessionId) {
        this.transports.set(transport.sessionId, transport);
      }
    });

    this.app.get('/mcp', this.authMiddleware, async (req: Request, res: Response) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId) {
        res.status(400).json({ error: 'Bad Request: Mcp-Session-Id header is required' });
        return;
      }
      const transport = this.transports.get(sessionId);
      if (!transport) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      await transport.handleRequest(req, res);
    });

    this.app.delete('/mcp', this.authMiddleware, async (req: Request, res: Response) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId) {
        res.status(400).json({ error: 'Bad Request: Mcp-Session-Id header is required' });
        return;
      }
      const transport = this.transports.get(sessionId);
      if (!transport) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      await transport.handleRequest(req, res);
      this.transports.delete(sessionId);
    });
  }

  public async start(): Promise<string> {
    return new Promise((resolve) => {
      this.server = http.createServer(this.app);
      this.server.listen(this.port, '127.0.0.1', () => {
        const addr = this.server!.address() as { port: number };
        this.port = addr.port;
        resolve(`http://127.0.0.1:${this.port}`);
      });
    });
  }

  public async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          this.server = null;
          resolve();
        });
      });
    }
  }
}
