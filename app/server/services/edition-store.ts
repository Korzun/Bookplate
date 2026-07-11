import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { ValidationThreshold } from '@korzun/epubcheck-ts';
import { Book, Device, Owner } from '../types';
import { buildEdition } from './edition-builder';
import { assertValidEpub, EpubValidationError } from './epub-validator';
import { partialMD5 } from './epub-parser';
import { logger } from '../logger';

const log = logger('edition-store');

export interface EditionDeps {
  buildEdition: typeof buildEdition;
  assertValidEpub: typeof assertValidEpub;
  partialMD5: typeof partialMD5;
}

const defaultDeps: EditionDeps = { buildEdition, assertValidEpub, partialMD5 };

function hasTransform(d: Device): boolean {
  return d.simplify || d.coverWidth !== null || d.coverHeight !== null || d.bwCover;
}

function settingsHash(book: Book, d: Device): string {
  return crypto
    .createHash('md5')
    .update(
      JSON.stringify({
        b: book.id,
        m: book.mtime.getTime(),
        w: d.coverWidth,
        h: d.coverHeight,
        f: d.coverFit,
        bw: d.bwCover,
        s: d.simplify,
      })
    )
    .digest('hex');
}

export class EditionStore {
  constructor(
    private readonly editionsRoot: string,
    private readonly prisma: PrismaClient,
    private readonly deps: EditionDeps = defaultDeps
  ) {}

  private editionPath(deviceId: string, userId: string, bookId: string): string {
    return path.join(this.editionsRoot, deviceId, userId, `${bookId}.epub`);
  }

  async getOrCreateEdition(
    owner: Owner,
    book: Book,
    device: Device,
    threshold: ValidationThreshold
  ): Promise<{ path: string; filename: string }> {
    if (!hasTransform(device)) return { path: book.path, filename: book.filename };

    const hash = settingsHash(book, device);
    const cachePath = this.editionPath(device.id, owner.userId, book.id);
    const key = {
      userId_originalBookId_deviceId: {
        userId: owner.userId,
        originalBookId: book.id,
        deviceId: device.id,
      },
    };

    const existing = await this.prisma.deviceEdition.findUnique({ where: key });
    if (existing && existing.settingsHash === hash && fs.existsSync(cachePath)) {
      return { path: cachePath, filename: book.filename };
    }

    let buffer: Buffer;
    try {
      buffer = await this.deps.buildEdition(book.path, {
        simplify: device.simplify,
        cover:
          device.coverWidth !== null || device.coverHeight !== null || device.bwCover
            ? {
                width: device.coverWidth,
                height: device.coverHeight,
                fit: device.coverFit,
                grayscale: device.bwCover,
              }
            : null,
      });
      await this.deps.assertValidEpub(buffer, threshold);
    } catch (err) {
      if (err instanceof EpubValidationError) {
        log.warn(
          `Edition for "${device.slug}" failed validation for "${book.filename}"; serving original`
        );
      } else {
        log.error(
          `Edition build failed for "${device.slug}"/"${book.filename}"; serving original: ${String(err)}`
        );
      }
      return { path: book.path, filename: book.filename };
    }

    // Write to a unique temp file, hash THAT file, then atomically rename it into
    // place. This keeps the recorded editionId matched to the exact bytes this
    // call produced even if a concurrent build targets the same cachePath, and
    // prevents a reader from observing a half-written file. Any disk/DB failure
    // here degrades to serving the original, like build/validation failures do.
    let tmpPath: string | undefined;
    try {
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      tmpPath = `${cachePath}.tmp-${crypto.randomUUID()}`;
      fs.writeFileSync(tmpPath, buffer);
      const editionId = this.deps.partialMD5(tmpPath);
      fs.renameSync(tmpPath, cachePath);
      tmpPath = undefined; // renamed into place; nothing left to clean up
      await this.prisma.deviceEdition.upsert({
        where: key,
        update: { editionId, settingsHash: hash },
        create: {
          userId: owner.userId,
          originalBookId: book.id,
          deviceId: device.id,
          editionId,
          settingsHash: hash,
        },
      });
      return { path: cachePath, filename: book.filename };
    } catch (err) {
      if (tmpPath !== undefined) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          /* best-effort cleanup */
        }
      }
      log.error(
        `Failed to persist edition for "${device.slug}"/"${book.filename}"; serving original: ${String(err)}`
      );
      return { path: book.path, filename: book.filename };
    }
  }

  async purgeForDevice(deviceId: string): Promise<void> {
    await this.prisma.deviceEdition.deleteMany({ where: { deviceId } });
    fs.rmSync(path.join(this.editionsRoot, deviceId), { recursive: true, force: true });
  }

  async purgeForBook(userId: string, originalBookId: string): Promise<void> {
    const rows = await this.prisma.deviceEdition.findMany({ where: { userId, originalBookId } });
    for (const r of rows) {
      try {
        fs.unlinkSync(this.editionPath(r.deviceId, userId, originalBookId));
      } catch {
        /* ignore */
      }
    }
    await this.prisma.deviceEdition.deleteMany({ where: { userId, originalBookId } });
  }

  async countForBook(userId: string, originalBookId: string): Promise<number> {
    return this.prisma.deviceEdition.count({ where: { userId, originalBookId } });
  }

  async purgeForUser(userId: string): Promise<void> {
    const rows = await this.prisma.deviceEdition.findMany({ where: { userId } });
    for (const r of rows) {
      try {
        fs.unlinkSync(this.editionPath(r.deviceId, userId, r.originalBookId));
      } catch {
        /* ignore */
      }
    }
    await this.prisma.deviceEdition.deleteMany({ where: { userId } });
  }
}
