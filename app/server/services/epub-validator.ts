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

// Severity order, most severe first — used to render the blocking summary.
const SEVERITY_ORDER: Severity[] = ['FATAL', 'ERROR', 'WARNING', 'INFO', 'USAGE'];

// Summarize the blocking messages by severity, e.g. "1 fatal, 2 error".
// Derived from the blocking set (not the full report counts) so the summary
// always matches what actually crossed the threshold.
function summarizeBlocking(messages: ValidationMessage[]): string {
  const counts: Partial<Record<Severity, number>> = {};
  for (const m of messages) {
    counts[m.severity] = (counts[m.severity] ?? 0) + 1;
  }
  const parts = SEVERITY_ORDER.filter((s) => counts[s]).map(
    (s) => `${counts[s]} ${s.toLowerCase()}`
  );
  return parts.join(', ') || `${messages.length} issue(s)`;
}

export class EpubValidationError extends Error {
  readonly messages: ValidationMessage[];
  readonly counts: Record<Severity, number>;
  readonly threshold: ValidationThreshold;

  constructor(
    messages: ValidationMessage[],
    counts: Record<Severity, number>,
    threshold: ValidationThreshold
  ) {
    super(`EPUB failed validation (threshold ${threshold}): ${summarizeBlocking(messages)}`);
    this.name = 'EpubValidationError';
    this.messages = messages;
    this.counts = counts;
    this.threshold = threshold;
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
    throw new EpubValidationError(blocking, report.counts, threshold);
  }
  return report;
}
