import type { PrismaClient } from '@prisma/client';

import type { Owner } from '../types';
import {
  splitSubjects,
  type Severity,
  type ValidationMessage,
  type ValidationReport,
} from './epub-validator';

export type StoredValidation = ValidationReport & { validatedAt: Date };

const SEVERITIES: Severity[] = ['FATAL', 'ERROR', 'WARNING', 'INFO', 'USAGE'];

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

  async getValidation(owner: Owner, bookId: string): Promise<StoredValidation | null> {
    const row = await this.prisma.validation.findUnique({
      where: { userId_bookId: { userId: owner.userId, bookId } },
      include: { messages: { orderBy: { seq: 'asc' } } },
    });
    if (!row) return null;

    const counts = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<Severity, number>;
    const messages: ValidationMessage[] = row.messages.map((m) => {
      const severity = m.severity as Severity;
      counts[severity] = (counts[severity] ?? 0) + 1;
      return {
        id: m.code,
        severity,
        message: m.message,
        segments: splitSubjects(m.message),
        location:
          m.path != null
            ? { path: m.path, line: m.line ?? undefined, column: m.column ?? undefined }
            : undefined,
      };
    });

    return {
      valid: row.valid,
      threshold: row.threshold as StoredValidation['threshold'],
      counts,
      messages,
      validatedAt: new Date(row.validatedAt),
    };
  }
}
