import express from 'express';
import request from 'supertest';

import { CONTENT_SECURITY_POLICY, securityHeaders } from './security-headers';

function buildApp(isProduction = true): express.Express {
  const app = express();
  app.use(securityHeaders({ isProduction }));
  app.get('/api/x', (_req, res) => void res.json({}));
  app.get('/graphql', (_req, res) => void res.send('<html>graphiql</html>'));
  app.post('/graphql', (_req, res) => void res.json({}));
  app.get('/mcp/oauth/authorize', (_req, res) => void res.send('ok'));
  app.get('/apiary', (_req, res) => void res.send('ok'));
  app.get('/', (_req, res) => void res.type('html').send('<p>hi</p>'));
  app.get('/opds/x', (_req, res) => void res.send('ok'));
  app.get('/api/covers/x', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('ETag', '"e"');
    res.send('c');
  });
  return app;
}

describe('securityHeaders', () => {
  it('sets the fixed headers on every route', async () => {
    const app = buildApp();
    for (const res of [
      await request(app).get('/api/x'),
      await request(app).post('/graphql'),
      await request(app).get('/mcp/oauth/authorize'),
      await request(app).get('/'),
      await request(app).get('/opds/x'),
      await request(app).get('/api/covers/x'),
    ]) {
      expect(res.headers['content-security-policy']).toBe(CONTENT_SECURITY_POLICY);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['referrer-policy']).toBe('same-origin');
      expect(res.headers['x-frame-options']).toBe('DENY');
    }
  });

  it('defaults API, GraphQL and MCP paths to no-store', async () => {
    const app = buildApp();
    expect((await request(app).get('/api/x')).headers['cache-control']).toBe('no-store');
    expect((await request(app).post('/graphql')).headers['cache-control']).toBe('no-store');
    expect((await request(app).get('/mcp/oauth/authorize')).headers['cache-control']).toBe(
      'no-store'
    );
  });

  it('leaves other paths alone', async () => {
    const app = buildApp();
    expect((await request(app).get('/')).headers['cache-control']).not.toBe('no-store');
    expect((await request(app).get('/opds/x')).headers['cache-control']).not.toBe('no-store');
    expect((await request(app).get('/apiary')).headers['cache-control']).not.toBe('no-store');
  });

  it('lets a route override Cache-Control and keep its ETag', async () => {
    const res = await request(buildApp()).get('/api/covers/x');
    expect(res.headers['cache-control']).toBe('public, max-age=86400');
    expect(res.headers['etag']).toBe('"e"');
  });

  it('sends exactly this CSP', async () => {
    const res = await request(buildApp()).get('/');
    expect(res.headers['content-security-policy']).toBe(
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'"
    );
  });

  it('drops the CSP from GET /graphql outside production, so GraphiQL loads', async () => {
    const dev = buildApp(false);
    const graphiql = await request(dev).get('/graphql');
    expect(graphiql.headers['content-security-policy']).toBeUndefined();
    expect(graphiql.headers['x-frame-options']).toBe('DENY');
    expect((await request(dev).post('/graphql')).headers['content-security-policy']).toBe(
      CONTENT_SECURITY_POLICY
    );
    expect((await request(dev).get('/')).headers['content-security-policy']).toBe(
      CONTENT_SECURITY_POLICY
    );
  });

  it('keeps the CSP on GET /graphql in production', async () => {
    const res = await request(buildApp(true)).get('/graphql');
    expect(res.headers['content-security-policy']).toBe(CONTENT_SECURITY_POLICY);
  });
});
