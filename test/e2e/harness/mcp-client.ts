export interface McpResponse {
  status: number;
  headers: Headers;
  rawBody: string;
  jsonRpc?: {
    jsonrpc: string;
    id?: number | string;
    result?: unknown;
    error?: {
      code: number;
      message: string;
      data?: unknown;
    };
  };
  sessionId?: string | null;
}

export class McpClient {
  public baseUrl: string;
  public sessionId: string | null = null;
  public token: string | null = null;
  public tokenHeaderName: 'Cf-Access-Jwt-Assertion' | 'Authorization' = 'Cf-Access-Jwt-Assertion';

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  public setToken(token: string | null, header: 'Cf-Access-Jwt-Assertion' | 'Authorization' = 'Cf-Access-Jwt-Assertion'): void {
    this.token = token;
    this.tokenHeaderName = header;
  }

  public getHeaders(extraHeaders: Record<string, string> = {}): Headers {
    const headers = new Headers({
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      ...extraHeaders,
    });

    if (this.sessionId && !headers.has('mcp-session-id')) {
      headers.set('mcp-session-id', this.sessionId);
    }

    if (this.token) {
      if (this.tokenHeaderName === 'Authorization') {
        if (!headers.has('authorization')) {
          headers.set('authorization', `Bearer ${this.token}`);
        }
      } else {
        if (!headers.has('cf-access-jwt-assertion')) {
          headers.set('cf-access-jwt-assertion', this.token);
        }
      }
    }

    return headers;
  }

  private parseJsonRpcFromSse(bodyText: string): unknown {
    const lines = bodyText.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data:')) {
        const jsonStr = trimmed.slice(5).trim();
        try {
          return JSON.parse(jsonStr);
        } catch {
          // continue
        }
      }
    }
    // If not SSE data, try parsing direct JSON
    try {
      return JSON.parse(bodyText);
    } catch {
      return undefined;
    }
  }

  public async getHealth(customHeaders?: Record<string, string>, path = '/health'): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    return fetch(url, {
      method: 'GET',
      headers: customHeaders,
    });
  }

  public async headHealth(customHeaders?: Record<string, string>): Promise<Response> {
    const url = `${this.baseUrl}/health`;
    return fetch(url, {
      method: 'HEAD',
      headers: customHeaders,
    });
  }

  public async sendJsonRpc(
    payload: unknown,
    options: {
      headers?: Record<string, string>;
      rawBody?: string;
    } = {}
  ): Promise<McpResponse> {
    const url = `${this.baseUrl}/mcp`;
    const headers = this.getHeaders(options.headers);

    const body = options.rawBody !== undefined ? options.rawBody : JSON.stringify(payload);

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
    });

    const sid = res.headers.get('mcp-session-id');
    if (sid) {
      this.sessionId = sid;
    }

    const rawBody = await res.text();
    const jsonRpc = this.parseJsonRpcFromSse(rawBody) as McpResponse['jsonRpc'];

    return {
      status: res.status,
      headers: res.headers,
      rawBody,
      jsonRpc,
      sessionId: sid,
    };
  }

  public async initialize(clientName = 'e2e-test-client', clientVersion = '1.0.0'): Promise<McpResponse> {
    return this.sendJsonRpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: clientName,
          version: clientVersion,
        },
      },
    });
  }

  public async sendNotification(method: string, params?: Record<string, unknown>): Promise<McpResponse> {
    return this.sendJsonRpc({
      jsonrpc: '2.0',
      method,
      params,
    });
  }

  public async listTools(id: number | string = 2): Promise<McpResponse> {
    return this.sendJsonRpc({
      jsonrpc: '2.0',
      id,
      method: 'tools/list',
      params: {},
    });
  }

  public async callTool(name: string, args: Record<string, unknown> = {}, id: number | string = 3): Promise<McpResponse> {
    return this.sendJsonRpc({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: {
        name,
        arguments: args,
      },
    });
  }

  public async deleteSession(): Promise<Response> {
    const url = `${this.baseUrl}/mcp`;
    const headers = this.getHeaders();
    return fetch(url, {
      method: 'DELETE',
      headers,
    });
  }

  public async getMcpStream(): Promise<Response> {
    const url = `${this.baseUrl}/mcp`;
    const headers = this.getHeaders({
      'Accept': 'text/event-stream',
    });
    return fetch(url, {
      method: 'GET',
      headers,
    });
  }
}
