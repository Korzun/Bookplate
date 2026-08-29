import { randomUUID } from 'crypto';

import { PrismaClient } from '@prisma/client';

import { Device } from '../types';
import { generateSlug } from '../utils/slug';
import { isPrismaError } from './prisma-errors';

export interface DeviceInput {
  name: string;
  coverWidth: number | null;
  coverHeight: number | null;
  coverFit: 'contain' | 'cover' | 'fill' | 'smart';
  bwCover: boolean;
  simplify: boolean;
}

/** Thrown when a create/update would violate the unique `slug` constraint. */
export class DeviceSlugConflictError extends Error {
  constructor() {
    super('A device with this name already exists');
    this.name = 'DeviceSlugConflictError';
  }
}

type Row = {
  id: string;
  name: string;
  slug: string;
  coverWidth: number | null;
  coverHeight: number | null;
  coverFit: string;
  bwCover: boolean;
  simplify: boolean;
};

/**
 * Maps a Prisma row to the app-level `Device` type. GraphQL does not need
 * it — `Device` is a `prismaObject`, so resolvers hand Pothos raw rows — but
 * `routes/opds.ts` passes a `Device` to `getOrCreateEdition`. When that call
 * site changes, this mapper can go.
 */
function toDevice(r: Row): Device {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    coverWidth: r.coverWidth,
    coverHeight: r.coverHeight,
    coverFit: r.coverFit as Device['coverFit'],
    bwCover: r.bwCover,
    simplify: r.simplify,
  };
}

export async function getBySlug(prisma: PrismaClient, slug: string): Promise<Device | null> {
  const r = await prisma.device.findUnique({ where: { slug } });
  return r ? toDevice(r) : null;
}

export async function isEnabled(
  prisma: PrismaClient,
  deviceId: string,
  userId: string
): Promise<boolean> {
  const row = await prisma.deviceUser.findUnique({
    where: { deviceId_userId: { deviceId, userId } },
  });
  return row !== null;
}

/**
 * Creates a device profile, deriving its `slug` from the name exactly as
 * `getBySlug`'s callers derive the one they look up. Converts the DB's
 * `slug @unique` violation (`P2002`, `prisma/schema.prisma`) into
 * `DeviceSlugConflictError`: "that name is taken" is a domain answer a client
 * renders, not a server fault, and that conversion is the reason this is a
 * function rather than an inlined statement (design spec, the placement
 * rule's second clause).
 *
 * Returns the new row's id, not the row: the one caller re-reads whatever
 * columns it needs through its own query.
 */
export async function createDevice(prisma: PrismaClient, input: DeviceInput): Promise<string> {
  try {
    const created = await prisma.device.create({
      data: { id: randomUUID(), slug: generateSlug(input.name), ...input },
    });
    return created.id;
  } catch (e) {
    if (isPrismaError(e, 'P2002')) throw new DeviceSlugConflictError();
    throw e;
  }
}

/**
 * Replaces a device profile's settings, returning the updated row's id — or
 * `null` when there is no such row (`P2025`), the same "the row wasn't there"
 * convention `deleteUser` and `clearProgress` use. `P2002` becomes
 * `DeviceSlugConflictError`, as in `createDevice`.
 *
 * No existence precheck, deliberately (spec, Resolved decision D-1): which
 * constraint the write violates decides the outcome, so a read beforehand
 * would cost a query and change nothing. Callers validate their input before
 * calling, so a request that is both malformed and unknown reports the
 * malformed body.
 */
export async function updateDevice(
  prisma: PrismaClient,
  deviceId: string,
  input: DeviceInput
): Promise<string | null> {
  try {
    const updated = await prisma.device.update({
      where: { id: deviceId },
      data: { slug: generateSlug(input.name), ...input, updatedAt: Date.now() },
    });
    return updated.id;
  } catch (e) {
    if (isPrismaError(e, 'P2025')) return null; // record no longer exists
    if (isPrismaError(e, 'P2002')) throw new DeviceSlugConflictError();
    throw e;
  }
}

/**
 * Deletes a device profile, returning `false` when there was no such row
 * (`P2025`) rather than throwing — same convention as `deleteUser`. Its
 * `DeviceUser` rows go with it (`onDelete: Cascade`, `prisma/schema.prisma`);
 * the on-disk edition cache does not, and is the caller's business.
 */
export async function deleteDevice(prisma: PrismaClient, deviceId: string): Promise<boolean> {
  try {
    await prisma.device.delete({ where: { id: deviceId } });
    return true;
  } catch (e) {
    if (isPrismaError(e, 'P2025')) return false; // already deleted
    throw e;
  }
}
