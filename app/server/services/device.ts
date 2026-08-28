import { PrismaClient } from '@prisma/client';

import { Device } from '../types';

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
