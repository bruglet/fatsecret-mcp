import http, { type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import * as jose from 'jose';

export interface MockJwksServerOptions {
  teamName?: string;
  teamDomain?: string;
  audTag?: string;
}

export class MockJwksServer {
  public server: Server | null = null;
  public port = 0;
  public teamName: string;
  public teamDomain: string;
  public audTag: string;

  public primaryKeyPair!: jose.GenerateKeyPairResult;
  public primaryJwk!: jose.JWK;

  public rotatedKeyPair!: jose.GenerateKeyPairResult;
  public rotatedJwk!: jose.JWK;

  public untrustedKeyPair!: jose.GenerateKeyPairResult;
  public untrustedJwk!: jose.JWK;

  private simulateError = false;

  constructor(options: MockJwksServerOptions = {}) {
    this.teamName = options.teamName || 'test-team';
    this.teamDomain = options.teamDomain || `https://${this.teamName}.cloudflareaccess.com`;
    this.audTag = options.audTag || '4714c1358e65fe4b408ad6d432a5f878f08194bdb4752441fd56faefa9b2b6f2';
  }

  public async initKeys(): Promise<void> {
    // 1. Primary active key
    this.primaryKeyPair = await jose.generateKeyPair('RS256', { extractable: true });
    this.primaryJwk = await jose.exportJWK(this.primaryKeyPair.publicKey);
    this.primaryJwk.kid = 'cf-key-primary-1';
    this.primaryJwk.alg = 'RS256';
    this.primaryJwk.use = 'sig';

    // 2. Rotated secondary key (still valid in JWKS)
    this.rotatedKeyPair = await jose.generateKeyPair('RS256', { extractable: true });
    this.rotatedJwk = await jose.exportJWK(this.rotatedKeyPair.publicKey);
    this.rotatedJwk.kid = 'cf-key-rotated-2';
    this.rotatedJwk.alg = 'RS256';
    this.rotatedJwk.use = 'sig';

    // 3. Untrusted key (not published in JWKS)
    this.untrustedKeyPair = await jose.generateKeyPair('RS256', { extractable: true });
    this.untrustedJwk = await jose.exportJWK(this.untrustedKeyPair.publicKey);
    this.untrustedJwk.kid = 'cf-key-untrusted-9';
    this.untrustedJwk.alg = 'RS256';
    this.untrustedJwk.use = 'sig';
  }

  public async start(): Promise<string> {
    if (!this.primaryKeyPair) {
      await this.initKeys();
    }

    return new Promise((resolve) => {
      this.server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);

        if (this.simulateError) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal Server Error' }));
          return;
        }

        if (url.pathname === '/cdn-cgi/access/certs') {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=3600',
          });
          res.end(
            JSON.stringify({
              keys: [this.primaryJwk, this.rotatedJwk],
              public_certs: [],
            })
          );
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      });

      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server!.address() as { port: number };
        this.port = address.port;
        resolve(`http://127.0.0.1:${this.port}`);
      });
    });
  }

  public setSimulateError(error: boolean): void {
    this.simulateError = error;
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

  public getJwksUrl(): string {
    return `http://127.0.0.1:${this.port}/cdn-cgi/access/certs`;
  }

  // ── Token Generation Helpers ──

  public async createValidToken(claims: Record<string, unknown> = {}): Promise<string> {
    return new jose.SignJWT({
      email: 'user@example.com',
      type: 'app',
      identity_nonce: 'nonce-12345',
      sub: 'user-id-123',
      ...claims,
    })
      .setProtectedHeader({ alg: 'RS256', kid: this.primaryJwk.kid })
      .setIssuedAt()
      .setIssuer(this.teamDomain)
      .setAudience(this.audTag)
      .setExpirationTime('1h')
      .sign(this.primaryKeyPair.privateKey);
  }

  public async createRotatedToken(claims: Record<string, unknown> = {}): Promise<string> {
    return new jose.SignJWT({
      email: 'user-rotated@example.com',
      type: 'app',
      ...claims,
    })
      .setProtectedHeader({ alg: 'RS256', kid: this.rotatedJwk.kid })
      .setIssuedAt()
      .setIssuer(this.teamDomain)
      .setAudience(this.audTag)
      .setExpirationTime('1h')
      .sign(this.rotatedKeyPair.privateKey);
  }

  public async createExpiredToken(claims: Record<string, unknown> = {}): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new jose.SignJWT({
      email: 'user-expired@example.com',
      ...claims,
    })
      .setProtectedHeader({ alg: 'RS256', kid: this.primaryJwk.kid })
      .setIssuedAt(now - 7200)
      .setIssuer(this.teamDomain)
      .setAudience(this.audTag)
      .setExpirationTime(now - 3600)
      .sign(this.primaryKeyPair.privateKey);
  }

  public async createNotBeforeToken(claims: Record<string, unknown> = {}): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new jose.SignJWT({
      email: 'user-future@example.com',
      ...claims,
    })
      .setProtectedHeader({ alg: 'RS256', kid: this.primaryJwk.kid })
      .setIssuedAt(now)
      .setNotBefore(now + 3600)
      .setIssuer(this.teamDomain)
      .setAudience(this.audTag)
      .setExpirationTime(now + 7200)
      .sign(this.primaryKeyPair.privateKey);
  }

  public async createWrongIssuerToken(claims: Record<string, unknown> = {}): Promise<string> {
    return new jose.SignJWT({
      email: 'user-wrong-iss@example.com',
      ...claims,
    })
      .setProtectedHeader({ alg: 'RS256', kid: this.primaryJwk.kid })
      .setIssuedAt()
      .setIssuer('https://wrong-team.cloudflareaccess.com')
      .setAudience(this.audTag)
      .setExpirationTime('1h')
      .sign(this.primaryKeyPair.privateKey);
  }

  public async createWrongAudToken(claims: Record<string, unknown> = {}): Promise<string> {
    return new jose.SignJWT({
      email: 'user-wrong-aud@example.com',
      ...claims,
    })
      .setProtectedHeader({ alg: 'RS256', kid: this.primaryJwk.kid })
      .setIssuedAt()
      .setIssuer(this.teamDomain)
      .setAudience('1111111111111111111111111111111111111111111111111111111111111111')
      .setExpirationTime('1h')
      .sign(this.primaryKeyPair.privateKey);
  }

  public async createArrayAudToken(claims: Record<string, unknown> = {}): Promise<string> {
    return new jose.SignJWT({
      email: 'user-array-aud@example.com',
      ...claims,
    })
      .setProtectedHeader({ alg: 'RS256', kid: this.primaryJwk.kid })
      .setIssuedAt()
      .setIssuer(this.teamDomain)
      .setAudience(['some-other-aud', this.audTag, 'third-aud'])
      .setExpirationTime('1h')
      .sign(this.primaryKeyPair.privateKey);
  }

  public async createUntrustedKeyToken(claims: Record<string, unknown> = {}): Promise<string> {
    return new jose.SignJWT({
      email: 'user-untrusted@example.com',
      ...claims,
    })
      .setProtectedHeader({ alg: 'RS256', kid: this.untrustedJwk.kid })
      .setIssuedAt()
      .setIssuer(this.teamDomain)
      .setAudience(this.audTag)
      .setExpirationTime('1h')
      .sign(this.untrustedKeyPair.privateKey);
  }

  public async createNoneAlgToken(claims: Record<string, unknown> = {}): Promise<string> {
    const payload = {
      email: 'user-none@example.com',
      iss: this.teamDomain,
      aud: this.audTag,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      ...claims,
    };
    const header = { alg: 'none', typ: 'JWT' };
    const b64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
    const b64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${b64Header}.${b64Payload}.`;
  }

  public async createHS256Token(claims: Record<string, unknown> = {}): Promise<string> {
    const secret = new TextEncoder().encode('secret-symmetric-key-123456789012');
    return new jose.SignJWT({
      email: 'user-hs256@example.com',
      ...claims,
    })
      .setProtectedHeader({ alg: 'HS256', kid: this.primaryJwk.kid })
      .setIssuedAt()
      .setIssuer(this.teamDomain)
      .setAudience(this.audTag)
      .setExpirationTime('1h')
      .sign(secret);
  }

  public async createTamperedToken(): Promise<string> {
    const valid = await this.createValidToken();
    const parts = valid.split('.');
    const tamperedSig = parts[2].split('').reverse().join('');
    return `${parts[0]}.${parts[1]}.${tamperedSig}`;
  }
}
