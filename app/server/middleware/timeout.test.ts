import express, { Request, Response } from 'express';
import request from 'supertest';
import { requestTimeout } from './timeout';

jest.mock('../logger');

function makeApp(ms: number, handler: (req: Request, res: Response) => void): express.Express {
  const app = express();
  app.use(requestTimeout(ms));
  app.get('/slow', handler);
  return app;
}

describe('requestTimeout', () => {
  it('responds 503 when the handler exceeds the limit', async () => {
    const app = makeApp(30, (_req, res) => {
      setTimeout(() => res.json({ ok: true }), 300);
    });
    const res = await request(app).get('/slow');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'Request timed out' });
  });

  it('passes a fast response through unchanged', async () => {
    const app = makeApp(200, (_req, res) => res.json({ ok: true }));
    const res = await request(app).get('/slow');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('does not throw when the timer fires after the response was already sent', async () => {
    const app = makeApp(20, (_req, res) => res.json({ ok: true }));
    const res = await request(app).get('/slow');
    expect(res.status).toBe(200);
    // Give the (already-cleared) timer time to have fired; must not error.
    await new Promise((r) => setTimeout(r, 50));
  });
});
