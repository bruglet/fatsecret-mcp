import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';

export interface AuthMiddlewareOptions {
  teamDomain?: string;
  audience?: string;
  skipAuth?: boolean;
  jwks?: JWTVerifyGetKey;
}

// In-memory cache for remote JWKS functions keyed by certs URL
const jwksCache = new Map<string, JWTVerifyGetKey>();

function getOrCreateRemoteJWKSet(certsUrl: string): JWTVerifyGetKey {
  let jwks = jwksCache.get(certsUrl);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(certsUrl));
    jwksCache.set(certsUrl, jwks);
  }
  return jwks;
}

export function createAuthMiddleware(options: AuthMiddlewareOptions = {}): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const skipAuth = options.skipAuth ?? (process.env.SKIP_AUTH === 'true');
    if (skipAuth) {
      next();
      return;
    }

    const rawTeamDomain = options.teamDomain || process.env.CF_ACCESS_TEAM_DOMAIN;
    const expectedAud = options.audience || process.env.CF_ACCESS_AUD;

    if (!rawTeamDomain || !expectedAud) {
      console.error(
        'Cloudflare Access authentication error: CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD must be set (or SKIP_AUTH=true for local development).'
      );
      res.status(500).json({
        error: 'Configuration Error',
        message: 'Cloudflare Access authentication is not configured on the server.',
      });
      return;
    }

    // Normalize team domain to hostname only (e.g. "team.cloudflareaccess.com")
    const cleanDomain = rawTeamDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const issuer = `https://${cleanDomain}`;
    const certsUrl = `${issuer}/cdn-cgi/access/certs`;

    // Extract token from cf-access-jwt-assertion or Authorization: Bearer <token>
    let token: string | undefined;
    const cfAssertion = req.headers['cf-access-jwt-assertion'];
    if (typeof cfAssertion === 'string' && cfAssertion.trim().length > 0) {
      token = cfAssertion.trim();
    } else {
      const authHeader = req.headers.authorization;
      if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7).trim();
      }
    }

    if (!token) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing Cloudflare Access JWT. Provide Cf-Access-Jwt-Assertion or Bearer token.',
      });
      return;
    }

    try {
      const keySet = options.jwks || getOrCreateRemoteJWKSet(certsUrl);
      const { payload } = await jwtVerify(token, keySet, {
        issuer,
        audience: expectedAud,
      });

      // Attach verified payload to request for downstream tools or logging
      (req as Request & { user?: unknown }).user = payload;
      next();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Token verification failed';
      res.status(401).json({
        error: 'Unauthorized',
        message: `Invalid Cloudflare Access token: ${errorMessage}`,
      });
    }
  };
}

export const cloudflareAccessAuth = createAuthMiddleware();
