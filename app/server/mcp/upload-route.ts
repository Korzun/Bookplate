/**
 * `PUT /mcp/uploads/:token` — the unauthenticated half of the MCP upload-link
 * flow. A tool mints a slot (`UploadSlots.create`) and hands the model a link;
 * the model's shell runs `curl --fail -T book.epub <link>`; the bytes land in
 * the staging dir; a later tool call claims them by `uploadId`.
 *
 * The token in the path IS the credential, so: an unknown, expired, or
 * already-used token all answer the same 404 (never distinguishable), the
 * route never logs the token (`requestLog` redacts the path; nothing here
 * logs it either), and a link is single-use — any failure after the first
 * byte is accepted burns it.
 *
 * The body streams straight to disk (never buffered: 50 MB on a Pi-class host
 * is not free), the byte cap is enforced as chunks arrive (Content-Length is
 * only a fast-path hint a client can lie about), and every failure — cap,
 * client abort, disk error, not-a-zip — removes the partial file. Nothing in
 * a stream listener may throw (a throw there is an `uncaughtException` that
 * takes the process down, not a rejected promise), so every listener body is
 * wrapped, same discipline as `fetch-epub.ts`. No route-specific timeout: the
 * app-wide `requestTimeout` in `server.ts` already bounds a stalled upload.
 */
import * as fs from 'fs';

import { Router, type Request, type Response } from 'express';

import { logger } from '../logger';
import { MAX_LINK_UPLOAD_BYTES, type UploadSlots } from '../services/upload-slots';

const log = logger('McpUpload');

/** `PK\x03\x04` — the local-file-header signature every EPUB (a zip) starts with. */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

const NOT_FOUND = { error: 'Upload link not found' };

const unlinkQuiet = (file: string): void => {
  try {
    fs.unlinkSync(file);
  } catch {
    /* never written, or already gone */
  }
};

async function startsWithZipMagic(file: string): Promise<boolean> {
  const handle = await fs.promises.open(file, 'r');
  try {
    const buf = Buffer.alloc(ZIP_MAGIC.length);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    return bytesRead === ZIP_MAGIC.length && buf.equals(ZIP_MAGIC);
  } finally {
    await handle.close();
  }
}

export function uploadRoute(deps: { uploadSlots: UploadSlots; maxBytes?: number }): Router {
  const { uploadSlots, maxBytes = MAX_LINK_UPLOAD_BYTES } = deps;
  const router = Router();

  function receive(req: Request, res: Response): void {
    const declared = req.headers['content-length'];
    if (declared !== undefined && Number(declared) > maxBytes) {
      // Link stays open: nothing was read, so a retry with a smaller file works.
      res.status(413).set('Connection', 'close').json({ error: 'Upload too large' });
      return;
    }

    const token = String(req.params.token);
    let slot: { uploadId: string; destPath: string } | null;
    try {
      slot = uploadSlots.beginReceive(token);
    } catch (err) {
      log.error(`could not start upload: ${err instanceof Error ? err.message : String(err)}`);
      res.status(500).json({ error: 'Upload failed' });
      return;
    }
    if (slot === null) {
      res.status(404).json(NOT_FOUND);
      return;
    }
    const { uploadId, destPath } = slot;

    const out = fs.createWriteStream(destPath);
    let bytes = 0;
    let settled = false;

    /** Burns the link, removes the file, and answers once (if still answerable). */
    const fail = (status: number | null, body?: unknown): void => {
      if (settled) return;
      settled = true;
      try {
        req.unpipe();
        out.destroy();
        uploadSlots.failReceive(uploadId);
        // `destroy()` may land before the async open created the file.
        out.once('close', () => unlinkQuiet(destPath));
        if (status !== null && !res.headersSent) {
          res.status(status).set('Connection', 'close').json(body);
        }
      } catch (err) {
        log.error(`upload cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    const onFinished = (): void => {
      void (async () => {
        try {
          if (!(await startsWithZipMagic(destPath))) {
            fail(415, { error: 'Upload is not an EPUB (zip) file' });
            return;
          }
          if (settled) return;
          if (!uploadSlots.completeReceive(uploadId, bytes)) {
            // Swept by expiry mid-PUT: the slot is gone, so is our claim on the file.
            unlinkQuiet(destPath);
            settled = true;
            res.status(404).json(NOT_FOUND);
            return;
          }
          settled = true;
          res.status(201).json({ uploadId, size: bytes });
        } catch (err) {
          log.error(`upload finalize failed: ${err instanceof Error ? err.message : String(err)}`);
          fail(500, { error: 'Upload failed' });
        }
      })();
    };

    req.on('data', (chunk: Buffer) => {
      try {
        if (settled) return;
        bytes += chunk.length;
        if (bytes > maxBytes) {
          fail(413, { error: 'Upload too large' });
          return;
        }
        if (!out.write(chunk)) {
          req.pause();
          out.once('drain', () => req.resume());
        }
      } catch {
        fail(500, { error: 'Upload failed' });
      }
    });
    req.on('end', () => {
      try {
        if (!settled) out.end();
      } catch {
        fail(500, { error: 'Upload failed' });
      }
    });
    req.on('aborted', () => fail(null));
    req.on('error', () => fail(null));
    out.on('error', () => fail(500, { error: 'Upload failed' }));
    out.on('finish', () => {
      if (!settled) onFinished();
    });
    // Connection gone before we answered (client abort, app-wide timeout).
    res.on('close', () => {
      if (!res.writableFinished) fail(null);
    });
  }

  router.put('/mcp/uploads/:token', receive);
  router.all('/mcp/uploads/:token', (_req, res) => {
    res.set('Allow', 'PUT').status(405).json({ error: 'Method not allowed' });
  });

  return router;
}
