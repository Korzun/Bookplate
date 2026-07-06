export type Severity = 'FATAL' | 'ERROR' | 'WARNING' | 'INFO' | 'USAGE';

// The admin-configured level at or above which a validation issue rejects the
// book; 'NONE' accepts everything. Mirrors the server's ValidationThreshold.
export type ValidationThreshold = Severity | 'NONE';

export interface ValidationMessage {
  id: string;
  severity: Severity;
  message: string;
  location?: string;
}

export interface ValidationFailure {
  messages: ValidationMessage[];
  counts: Record<Severity, number>;
  threshold: ValidationThreshold;
}

export interface SeverityCount {
  severity: Severity;
  count: number;
}

export const SEVERITY_ORDER: readonly Severity[] = ['FATAL', 'ERROR', 'WARNING', 'INFO', 'USAGE'];

// Severity ranking, least to most severe. Mirrors the server's RANK map so the
// client agrees on which severities crossed the configured threshold.
export const RANK: Record<Severity, number> = {
  USAGE: 1,
  INFO: 2,
  WARNING: 3,
  ERROR: 4,
  FATAL: 5,
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  FATAL: 'Fatal',
  ERROR: 'Error',
  WARNING: 'Warning',
  INFO: 'Info',
  USAGE: 'Usage',
};

export const THRESHOLD_LABEL: Record<ValidationThreshold, string> = {
  ...SEVERITY_LABEL,
  NONE: 'None',
};

// A severity is blocking when it meets or exceeds the configured threshold.
// With threshold 'NONE', nothing blocks.
export function isBlockingAtThreshold(severity: Severity, threshold: ValidationThreshold): boolean {
  return threshold !== 'NONE' && RANK[severity] >= RANK[threshold];
}

export function orderSeverityCounts(counts: Record<Severity, number>): SeverityCount[] {
  return SEVERITY_ORDER.map((severity) => ({ severity, count: counts[severity] ?? 0 })).filter(
    (entry) => entry.count > 0
  );
}
