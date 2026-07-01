import { validateEpub } from 'epubcheck-ts';
import type { Report, Message, Severity } from 'epubcheck-ts';

export interface ValidationMessage {
  id: string;
  severity: Severity;
  message: string;
  location?: string;
}

const BLOCKING: ReadonlySet<Severity> = new Set<Severity>(['FATAL', 'ERROR']);

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

export async function assertValidEpub(bytes: Buffer): Promise<Report> {
  const report = await validateEpub(bytes);
  if (!report.valid) {
    const blocking = formatMessages(report.messages.filter((m) => BLOCKING.has(m.severity)));
    throw new EpubValidationError(blocking, report.counts);
  }
  return report;
}
