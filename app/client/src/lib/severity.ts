export type Severity = 'FATAL' | 'ERROR' | 'WARNING' | 'INFO' | 'USAGE';

export interface ValidationMessage {
  id: string;
  severity: Severity;
  message: string;
  location?: string;
}

export interface ValidationFailure {
  messages: ValidationMessage[];
  counts: Record<Severity, number>;
}

export interface SeverityCount {
  severity: Severity;
  count: number;
}

export const SEVERITY_ORDER: readonly Severity[] = [
  'FATAL',
  'ERROR',
  'WARNING',
  'INFO',
  'USAGE',
];

export const SEVERITY_LABEL: Record<Severity, string> = {
  FATAL: 'Fatal',
  ERROR: 'Error',
  WARNING: 'Warning',
  INFO: 'Info',
  USAGE: 'Usage',
};

const BLOCKING: ReadonlySet<Severity> = new Set<Severity>(['FATAL', 'ERROR']);

export function isBlocking(severity: Severity): boolean {
  return BLOCKING.has(severity);
}

export function orderSeverityCounts(counts: Record<Severity, number>): SeverityCount[] {
  return SEVERITY_ORDER.map((severity) => ({ severity, count: counts[severity] ?? 0 })).filter(
    (entry) => entry.count > 0
  );
}
