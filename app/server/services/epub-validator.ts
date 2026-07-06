import { validateEpub } from '@korzun/epubcheck-ts';
import type { Report, Message, Severity, ValidationThreshold } from '@korzun/epubcheck-ts';

export interface ValidationMessage {
  id: string;
  severity: Severity;
  message: string;
  location?: string;
}

const RANK: Record<Severity, number> = {
  USAGE: 1,
  INFO: 2,
  WARNING: 3,
  ERROR: 4,
  FATAL: 5,
};

// Rank floor for the presentation filter only — the library owns the
// accept/reject decision via report.valid.
function thresholdRank(threshold: ValidationThreshold): number {
  return threshold === 'NONE' ? Infinity : RANK[threshold];
}

export function formatMessages(messages: Message[]): ValidationMessage[] {
  return messages.map((m) => ({
    id: m.id,
    severity: m.severity,
    message: m.message,
    location: m.location ? String(m.location.path ?? '') || undefined : undefined,
  }));
}

export class EpubValidationError extends Error {
  readonly messages: ValidationMessage[];
  readonly counts: Record<Severity, number>;

  constructor(messages: ValidationMessage[], counts: Record<Severity, number>) {
    super(`EPUB failed validation: ${counts.FATAL} fatal, ${counts.ERROR} error(s)`);
    this.name = 'EpubValidationError';
    this.messages = messages;
    this.counts = counts;
  }
}

export async function assertValidEpub(
  bytes: Buffer,
  threshold: ValidationThreshold
): Promise<Report> {
  const report = await validateEpub(bytes, { threshold });
  if (!report.valid) {
    const floor = thresholdRank(threshold);
    const blocking = formatMessages(report.messages.filter((m) => RANK[m.severity] >= floor));
    throw new EpubValidationError(blocking, report.counts);
  }
  return report;
}
