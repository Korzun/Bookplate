import { randomUUID } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { Device } from '../types';
import { generateSlug } from '../utils/slug';

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

function isPrismaError(err: unknown, code: string): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;
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

export class DeviceStore {
  constructor(private readonly prisma: PrismaClient) {}

  async list(): Promise<Device[]> {
    const rows = await this.prisma.device.findMany({ orderBy: { name: 'asc' } });
    return rows.map(toDevice);
  }
  async getById(id: string): Promise<Device | null> {
    const r = await this.prisma.device.findUnique({ where: { id } });
    return r ? toDevice(r) : null;
  }
  async getBySlug(slug: string): Promise<Device | null> {
    const r = await this.prisma.device.findUnique({ where: { slug } });
    return r ? toDevice(r) : null;
  }
  async create(input: DeviceInput): Promise<Device> {
    try {
      const r = await this.prisma.device.create({
        data: { id: randomUUID(), slug: generateSlug(input.name), ...input },
      });
      return toDevice(r);
    } catch (err) {
      if (isPrismaError(err, 'P2002')) throw new DeviceSlugConflictError();
      throw err;
    }
  }
  async update(id: string, input: DeviceInput): Promise<Device | null> {
    try {
      const r = await this.prisma.device.update({
        where: { id },
        data: { slug: generateSlug(input.name), ...input, updatedAt: Date.now() },
      });
      return toDevice(r);
    } catch (err) {
      if (isPrismaError(err, 'P2025')) return null; // record no longer exists
      if (isPrismaError(err, 'P2002')) throw new DeviceSlugConflictError();
      throw err;
    }
  }
  async delete(id: string): Promise<boolean> {
    try {
      await this.prisma.device.delete({ where: { id } });
      return true;
    } catch (err) {
      if (isPrismaError(err, 'P2025')) return false; // already deleted
      throw err;
    }
  }
}
