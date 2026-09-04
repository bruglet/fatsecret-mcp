import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT, exportJWK } from 'jose';
import type { Request, Response } from 'express';
import { createAuthMiddleware } from '../src/auth-middleware.js';

interface MockResponse extends Partial<Response> {
  statusCode: number;
  data?: unknown;
}

function createMockRes(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this as Response;
    },
    json(data: unknown) {
      this.data = data;
      return this as Response;
    },
  };
  return res;
}

describe('Cloudflare Access JWT Middleware', () => {
  const teamDomain = 'test-team.cloudflareaccess.com';
  const audience = 'test-aud-tag-12345';
  const issuer = `https://${teamDomain}`;

  it('bypasses authentication when skipAuth is true', async () => {
    const middleware = createAuthMiddleware({ skipAuth: true });
    let nextCalled = false;
    const req = { headers: {} } as Request;
    const res = createMockRes();

    await middleware(req, res as unknown as Response, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
  });

  it('returns 500 if teamDomain or audience are missing when skipAuth is false', async () => {
    const prevDomain = process.env.CF_ACCESS_TEAM_DOMAIN;
    const prevAud = process.env.CF_ACCESS_AUD;
    delete process.env.CF_ACCESS_TEAM_DOMAIN;
    delete process.env.CF_ACCESS_AUD;

    const middleware = createAuthMiddleware({ skipAuth: false, teamDomain: '', audience: '' });
    const req = { headers: {} } as Request;
    const res = createMockRes();
    let nextCalled = false;

    await middleware(req, res as unknown as Response, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 500);

    if (prevDomain) process.env.CF_ACCESS_TEAM_DOMAIN = prevDomain;
    if (prevAud) process.env.CF_ACCESS_AUD = prevAud;
  });

  it('returns 401 if token is missing', async () => {
    const middleware = createAuthMiddleware({
      skipAuth: false,
      teamDomain,
      audience,
    });
    const req = { headers: {} } as Request;
    const res = createMockRes();
    let nextCalled = false;

    await middleware(req, res as unknown as Response, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.match((res.data as { message: string }).message, /Missing Cloudflare Access JWT/);
  });

  it('authenticates valid token from Cf-Access-Jwt-Assertion header', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    jwk.kid = 'test-key-1';

    const token = await new SignJWT({ email: 'user@example.com', sub: 'user_123' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience(audience)
      .setExpirationTime('2h')
      .sign(privateKey);

    const mockJwks = async () => publicKey;

    const middleware = createAuthMiddleware({
      skipAuth: false,
      teamDomain,
      audience,
      jwks: mockJwks,
    });

    const req = {
      headers: {
        'cf-access-jwt-assertion': token,
      },
    } as unknown as Request & { user?: unknown };
    const res = createMockRes();
    let nextCalled = false;

    await middleware(req, res as unknown as Response, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
    assert.equal((req.user as { email: string }).email, 'user@example.com');
  });

  it('authenticates valid token from Authorization: Bearer header', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const token = await new SignJWT({ sub: 'user_456' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-2' })
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience(audience)
      .setExpirationTime('2h')
      .sign(privateKey);

    const mockJwks = async () => publicKey;

    const middleware = createAuthMiddleware({
      skipAuth: false,
      teamDomain,
      audience,
      jwks: mockJwks,
    });

    const req = {
      headers: {
        authorization: `Bearer ${token}`,
      },
    } as unknown as Request & { user?: unknown };
    const res = createMockRes();
    let nextCalled = false;

    await middleware(req, res as unknown as Response, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal((req.user as { sub: string }).sub, 'user_456');
  });

  it('rejects token with wrong audience', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const token = await new SignJWT({ sub: 'user_789' })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience('wrong-aud-tag')
      .setExpirationTime('2h')
      .sign(privateKey);

    const mockJwks = async () => publicKey;

    const middleware = createAuthMiddleware({
      skipAuth: false,
      teamDomain,
      audience,
      jwks: mockJwks,
    });

    const req = {
      headers: {
        'cf-access-jwt-assertion': token,
      },
    } as unknown as Request;
    const res = createMockRes();
    let nextCalled = false;

    await middleware(req, res as unknown as Response, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.match((res.data as { message: string }).message, /Invalid Cloudflare Access token/);
  });
});
