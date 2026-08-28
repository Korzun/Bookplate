import type { PrismaClient } from '@prisma/client';

import type { Owner } from '../types';
import type { ValidationReport } from './epub-validator';

export class ValidationStore {
  constructor(private readonly prisma: PrismaClient) {}

  async saveValidation(owner: Owner, bookId: string, report: ValidationReport): Promise<void> {
    const key = { userId: owner.userId, bookId };
    await this.prisma.$transaction(async (tx) => {
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
}
