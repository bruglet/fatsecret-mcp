import express, { type Request, type Response, type Router, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

export interface StreamableTransportOptions {
  createServer: () => McpServer;
}

export interface McpRouterContext {
  router: Router;
  transports: Record<string, StreamableHTTPServerTransport>;
  servers: Record<string, McpServer>;
  closeAllSessions: () => Promise<void>;
}

export function createMcpTransport(options: StreamableTransportOptions): McpRouterContext {
  const router = express.Router();
  const transports: Record<string, StreamableHTTPServerTransport> = {};
  const servers: Record<string, McpServer> = {};

  const cleanSession = async (sessionId: string) => {
    delete transports[sessionId];
    const s = servers[sessionId];
    if (s) {
      delete servers[sessionId];
      await s.close().catch(() => {});
    }
  };

  // POST /mcp: Handshake and message exchange
  router.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    try {
      // 1. Route to existing session
      if (sessionId && transports[sessionId]) {
        await transports[sessionId].handleRequest(req, res, req.body);
        return;
      }

      // 2. Initialize new session
      const isInit =
        isInitializeRequest(req.body) ||
        (Boolean(req.body) &&
          typeof req.body === 'object' &&
          (req.body as Record<string, unknown>).method === 'initialize');

      if (!sessionId && isInit) {
        let currentServer: McpServer | null = null;
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid: string) => {
            transports[sid] = transport;
            if (currentServer) {
              servers[sid] = currentServer;
            }
          },
          onsessionclosed: async (sid: string) => {
            await cleanSession(sid);
          },
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) {
            void cleanSession(sid);
          }
        };

        currentServer = options.createServer();
        await currentServer.connect(transport);

        await transport.handleRequest(req, res, req.body);

        if (transport.sessionId) {
          transports[transport.sessionId] = transport;
          if (currentServer) {
            servers[transport.sessionId] = currentServer;
          }
        }
        return;
      }

      // 3. Error: Unknown session
      if (sessionId) {
        res.status(404).json({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Session not found' },
          id: null,
        });
        return;
      }

      // 4. Error: Missing session ID on non-init request
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
        id: null,
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /mcp: Standalone SSE stream
  router.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId) {
      res.status(400).json({ error: 'Bad Request: Mcp-Session-Id header is required' });
      return;
    }
    const transport = transports[sessionId];
    if (!transport) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    try {
      await transport.handleRequest(req, res);
    } catch (err) {
      next(err);
    }
  });

  // DELETE /mcp: Explicit session teardown
  router.delete('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId) {
      res.status(400).json({ error: 'Bad Request: Mcp-Session-Id header is required' });
      return;
    }
    const transport = transports[sessionId];
    if (!transport) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    try {
      await transport.handleRequest(req, res);
      await cleanSession(sessionId);
    } catch (err) {
      next(err);
    }
  });

  const closeAllSessions = async (): Promise<void> => {
    const sessionIds = Object.keys(transports);
    for (const sid of sessionIds) {
      const transport = transports[sid];
      await cleanSession(sid);
      if (transport) {
        await transport.close().catch(() => {});
      }
    }
  };

  return { router, transports, servers, closeAllSessions };
}
