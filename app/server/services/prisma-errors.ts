import { Prisma } from '@prisma/client';

/** True when `err` is a Prisma known-request error carrying the given error code. */
export function isPrismaError(err: unknown, code: string): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;
}
