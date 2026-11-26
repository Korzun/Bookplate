import type { RequestHandler } from 'express';

export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; " +
  "connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; " +
  "form-action 'self'; object-src 'none'";

const NO_STORE_PREFIXES = ['/api/', '/graphql', '/mcp'];

/**
 * Sets the fixed security headers on every response and defaults API-shaped
 * paths to `Cache-Control: no-store`. Routes that set their own
 * `Cache-Control` later simply overwrite the default. Mount it first, so
 * `req.path` is the full path.
 *
 * Outside production, `GET /graphql` gets no CSP: yoga serves GraphiQL there,
 * which needs CDN scripts and inline script.
 */
export function securityHeaders({ isProduction }: { isProduction: boolean }): RequestHandler {
  return (req, res, next) => {
    const graphiql = !isProduction && req.method === 'GET' && req.path === '/graphql';
    if (!graphiql) res.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    res.set('X-Frame-Options', 'DENY');
    if (NO_STORE_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
      res.set('Cache-Control', 'no-store');
    }
    next();
  };
}
