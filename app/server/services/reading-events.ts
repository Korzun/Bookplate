/**
 * Storage for the events the Bookplate CrossPoint plugin posts from the
 * device (`POST /sync/crosspoint/events`). Write-only for now: rows are kept
 * raw, and reading stats are derived from them later.
 */
import type { PrismaClient } from '@prisma/client';

import { isPrismaError } from './prisma-errors';

/** The envelope fields the receiver relies on. Everything else stays in `body`. */
export type ReadingEventEnvelope = {
  event: string;
  id: string;
  ts: number;
  deviceId: string;
  document: string | null;
};

const PARTIAL_MD5 = /^[0-9a-f]{32}$/;

/**
 * Pulls the envelope out of a parsed request body, or returns null when a
 * field the receiver depends on is missing. The firmware substitutes every
 * value as text, so `ts` arrives as a decimal string; a variable it could not
 * fill is sent literally (`"{event.document}"`), which is why `document` is
 * kept only when it looks like a hash.
 */
export function parseReadingEventEnvelope(body: unknown): ReadingEventEnvelope | null {
  if (typeof body !== 'object' || body === null) return null;
  const { event, id, ts, deviceId, vars } = body as Record<string, unknown>;
  if (!isNonEmptyString(event) || !isNonEmptyString(id) || !isNonEmptyString(deviceId)) {
    return null;
  }
  const tsText = typeof ts === 'number' ? String(ts) : ts;
  if (typeof tsText !== 'string' || !/^\d+$/.test(tsText)) return null;
  const document = (vars as Record<string, unknown> | undefined)?.document;
  return {
    event,
    id,
    ts: Number(tsText),
    deviceId,
    document: typeof document === 'string' && PARTIAL_MD5.test(document) ? document : null,
  };
}

/**
 * Stores one event. Returns `false` when this device already delivered the
 * same event id — the firmware retries until it sees a 2xx, so a redelivery
 * is expected and is not an error.
 */
export async function recordReadingEvent(
  prisma: PrismaClient,
  userId: string,
  envelope: ReadingEventEnvelope,
  body: unknown
): Promise<boolean> {
  try {
    await prisma.readingEvent.create({
      data: {
        userId,
        deviceId: envelope.deviceId,
        eventId: envelope.id,
        event: envelope.event,
        ts: envelope.ts,
        document: envelope.document,
        body: JSON.stringify(body),
        receivedAt: Date.now(),
      },
    });
    return true;
  } catch (e) {
    if (isPrismaError(e, 'P2002')) return false;
    throw e;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
