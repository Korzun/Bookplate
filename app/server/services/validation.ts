import type { PrismaClient } from '@prisma/client';

import type { Owner } from '../types';
import type { ValidationReport } from './epub-validator';

/**
 * Persists a validation report: upserts the `Validation` row and replaces its
 * `ValidationMessage` rows wholesale. A transaction rather than three loose
 * statements because a partial write would leave a report's severity counts
 * disagreeing with its messages.
 *
 * A function rather than an inlined query despite being pure Prisma — three
 * production callers (`routes/ui.ts`, `apply-epub-changes.ts`,
 * `revalidate-library.ts`) would each have to reproduce the transaction.
 */
export async function saveValidation(
  prisma: PrismaClient,
  owner: Owner,
  bookId: string,
  report: ValidationReport
): Promise<void> {
  const key = { userId: owner.userId, bookId };
  await prisma.$transaction(async (tx) => {
    await tx.validation.upsert({
      where: { userId_bookId: key },
      create: {
        ...key,
        valid: report.valid,
        threshold: report.threshold,
        validatedAt: Date.now(),
      },
      update: { valid: report.valid, threshold: report.threshold, validatedAt: Date.now() },
    });
    await tx.validationMessage.deleteMany({ where: key });
    if (report.messages.length > 0) {
      await tx.validationMessage.createMany({
        data: report.messages.map((m, seq) => ({
          ...key,
          seq,
          code: m.id,
          severity: m.severity,
          message: m.message,
          path: m.location?.path ?? null,
          line: m.location?.line ?? null,
          column: m.location?.column ?? null,
        })),
      });
    }
  });
}
