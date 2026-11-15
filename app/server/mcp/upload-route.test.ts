import * as fs from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';

import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { requestTimeout } from '../middleware/timeout';
import { createUploadSlots, type UploadSlots } from '../services/upload-slots';
import { uploadRoute } from './upload-route';

const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('rest of the epub')]);
const NOT_FOUND = { error: 'Upload link not found' };

/** Polls until `cond` holds; generous deadline for a loaded machine. */
async function waitFor(cond: () => boolean, ms = 20_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('PUT /mcp/uploads/:token', () => {
  let dir: string;
  let slots: UploadSlots;
  let server: http.Server;

  const stagingFiles = () => fs.readdirSync(dir).filter((f) => f.startsWith('mcp-link-'));

  async function start(maxBytes?: number, timeoutMs?: number) {
    const app = express();
    if (timeoutMs !== undefined) app.use(requestTimeout(timeoutMs));
    app.use(uploadRoute({ uploadSlots: slots, maxBytes }));
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return server;
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-route-'));
    slots = createUploadSlots({ stagingDir: dir });
  });
  afterEach(async () => {
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('stores a zip body and answers 201 with uploadId and size', async () => {
    const link = slots.create('u1', 'book.epub');
    const res = await request(await start())
      .put(`/mcp/uploads/${link.token}`)
      .set('Content-Type', 'application/epub+zip')
      .send(ZIP);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ uploadId: link.uploadId, size: ZIP.length });
    const claimed = slots.claim(link.uploadId, 'u1');
    expect(claimed.kind).toBe('claimed');
    if (claimed.kind === 'claimed') {
      expect(claimed.file.size).toBe(ZIP.length);
      expect(fs.readFileSync(claimed.file.path).equals(ZIP)).toBe(true);
    }
  });

  it('rejects a second PUT to the same link with 404', async () => {
    const link = slots.create('u1');
    const app = await start();
    await request(app).put(`/mcp/uploads/${link.token}`).send(ZIP).expect(201);
    const res = await request(app).put(`/mcp/uploads/${link.token}`).send(ZIP);
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
  });

  it('rejects an unknown token with 404 and the generic message', async () => {
    const res = await request(await start())
      .put('/mcp/uploads/nope')
      .send(ZIP);
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    expect(res.headers.connection).toBe('close');
  });

  it('rejects Content-Length over the cap with 413 before reading, leaving the link open', async () => {
    const link = slots.create('u1');
    const app = await start(1024);
    const res = await request(app)
      .put(`/mcp/uploads/${link.token}`)
      .send(Buffer.concat([ZIP, Buffer.alloc(2000)]));
    expect(res.status).toBe(413);
    expect(stagingFiles()).toEqual([]);
    await request(app).put(`/mcp/uploads/${link.token}`).send(ZIP).expect(201);
  });

  it('aborts a chunked body that grows past the cap with 413 and removes the file', async () => {
    const link = slots.create('u1');
    const srv = await start(1024);
    const { port } = srv.address() as AddressInfo;
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        { port, host: '127.0.0.1', method: 'PUT', path: `/mcp/uploads/${link.token}` },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        }
      );
      req.on('error', reject);
      expect(req.getHeader('content-length')).toBeUndefined();
      req.write(ZIP);
      req.write(Buffer.alloc(600));
      req.write(Buffer.alloc(600));
      req.end();
    });
    expect(status).toBe(413);
    await waitFor(() => stagingFiles().length === 0);
    expect(slots.claim(link.uploadId, 'u1')).toEqual({ kind: 'missing' });
  });

  it('rejects a non-zip body with 415, removes the file, burns the link', async () => {
    const link = slots.create('u1');
    const app = await start();
    const res = await request(app).put(`/mcp/uploads/${link.token}`).send('<html>nope</html>');
    expect(res.status).toBe(415);
    expect(stagingFiles()).toEqual([]);
    expect(slots.claim(link.uploadId, 'u1')).toEqual({ kind: 'missing' });
    await request(app).put(`/mcp/uploads/${link.token}`).send(ZIP).expect(404);
  });

  it('removes the partial file when the client aborts mid-upload', async () => {
    const link = slots.create('u1');
    const srv = await start();
    const { port } = srv.address() as AddressInfo;
    await new Promise<void>((resolve, reject) => {
      const req = http.request({
        port,
        host: '127.0.0.1',
        method: 'PUT',
        path: `/mcp/uploads/${link.token}`,
        headers: { 'Content-Length': String(ZIP.length + 5000) },
      });
      req.on('error', () => undefined);
      req.write(ZIP);
      // The server has begun receiving once the staging file exists.
      void waitFor(() => stagingFiles().length === 1).then(() => {
        req.destroy();
        resolve();
      }, reject);
    });
    await waitFor(() => stagingFiles().length === 0);
    expect(stagingFiles()).toEqual([]);
    expect(slots.claim(link.uploadId, 'u1')).toEqual({ kind: 'missing' });
  });

  it('answers 404 and removes the file when the slot expired mid-PUT', async () => {
    let clock = 1_000;
    slots = createUploadSlots({ stagingDir: dir, now: () => clock, ttlMs: 100 });
    const link = slots.create('u1');
    const srv = await start();
    const { port } = srv.address() as AddressInfo;
    const result = new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request(
        { port, host: '127.0.0.1', method: 'PUT', path: `/mcp/uploads/${link.token}` },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        }
      );
      req.on('error', reject);
      req.write(ZIP);
      // The server has begun receiving once the staging file exists.
      void waitFor(() => stagingFiles().length === 1).then(() => {
        clock += 1_000;
        slots.sweep();
        req.end();
      }, reject);
    });
    const res = await result;
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body)).toEqual(NOT_FOUND);
    expect(stagingFiles()).toEqual([]);
  });

  it('releases a stalled upload when the app-wide timeout fires', async () => {
    const link = slots.create('u1');
    const srv = await start(undefined, 200);
    const { port } = srv.address() as AddressInfo;
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        { port, host: '127.0.0.1', method: 'PUT', path: `/mcp/uploads/${link.token}` },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        }
      );
      req.on('error', () => undefined);
      req.on('error', reject);
      req.write(ZIP); // then stall: never end
    });
    expect(status).toBe(503);
    await waitFor(() => stagingFiles().length === 0);
    expect(slots.claim(link.uploadId, 'u1')).toEqual({ kind: 'missing' });
  });

  it('does not leave a slot filled when the upload finishes after the timeout', async () => {
    const link = slots.create('u1');
    const srv = await start(undefined, 200);
    const { port } = srv.address() as AddressInfo;
    const status = await new Promise<number>((resolve) => {
      const req = http.request(
        { port, host: '127.0.0.1', method: 'PUT', path: `/mcp/uploads/${link.token}` },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
          // Finish only after the 503 is out (best effort: the route may already
          // have torn the connection down, which is the desired outcome too).
          req.end();
        }
      );
      req.on('error', () => undefined);
      req.write(ZIP);
    });
    expect(status).toBe(503);
    await waitFor(() => stagingFiles().length === 0);
    expect(slots.claim(link.uploadId, 'u1')).toEqual({ kind: 'missing' });
  });

  it('GET on the upload path is 405 with Allow: PUT', async () => {
    const link = slots.create('u1');
    const res = await request(await start()).get(`/mcp/uploads/${link.token}`);
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('PUT');
  });
});
