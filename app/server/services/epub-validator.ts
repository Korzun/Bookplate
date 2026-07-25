import { validateEpub } from '@korzun/epubcheck-ts';
import type { Report, Message, Severity, ValidationThreshold } from '@korzun/epubcheck-ts';

// A message split into display runs. A run with `subject: true` was a
// double-quoted span in the raw message (quotes stripped) — the client renders
// it monospaced. Plain prose runs have `subject` unset.
export interface MessageSegment {
  text: string;
  subject?: boolean;
}

export interface ValidationMessage {
  id: string;
  severity: Severity;
  message: string;
  // Optional: always populated by formatMessages, but callers that build a
  // ValidationMessage by hand (e.g. tests) may omit it.
  segments?: MessageSegment[];
  location?: { path: string; line?: number; column?: number };
}

// Split a message into plain/subject runs on its double-quoted spans, dropping
// the quotes: `Referenced resource "a/b.xhtml" could not be found` becomes
// [{text: 'Referenced resource '}, {text: 'a/b.xhtml', subject: true},
//  {text: ' could not be found'}]. Messages with no quotes yield a single run.
export function splitSubjects(message: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let last = 0;
  for (const match of message.matchAll(/"([^"]*)"/g)) {
    const start = match.index ?? 0;
    if (start > last) {
      segments.push({ text: message.slice(last, start) });
    }
    segments.push({ text: match[1], subject: true });
    last = start + match[0].length;
  }
  if (last < message.length) {
    segments.push({ text: message.slice(last) });
  }
  return segments.length > 0 ? segments : [{ text: message }];
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
    segments: splitSubjects(m.message),
    location: m.location?.path
      ? { path: m.location.path, line: m.location.line, column: m.location.column }
      : undefined,
  }));
}

// Severity order, most severe first — used to render the blocking summary.
const SEVERITY_ORDER: Severity[] = ['FATAL', 'ERROR', 'WARNING', 'INFO', 'USAGE'];

// Summarize the blocking messages by severity, e.g. "1 fatal, 2 error".
// Filters to severities at/above the threshold so the summary always matches
// what actually crossed it, even though `messages` now holds every severity.
function summarizeBlocking(messages: ValidationMessage[], threshold: ValidationThreshold): string {
  const floor = thresholdRank(threshold);
  const counts: Partial<Record<Severity, number>> = {};
  for (const m of messages) {
    if (RANK[m.severity] < floor) continue;
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
    super(
      `EPUB failed validation (threshold ${threshold}): ${summarizeBlocking(messages, threshold)}`
    );
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
    const messages = formatMessages(report.messages);
    throw new EpubValidationError(messages, report.counts, threshold);
  }
  return report;
}
