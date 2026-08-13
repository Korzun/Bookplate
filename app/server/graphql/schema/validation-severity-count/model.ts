import type { Severity } from '@korzun/epubcheck-ts';

import { builder } from '../builder';
import { model as validationSeverity } from '../validation-severity';

export type ValidationSeverityCountShape = { severity: string; count: number };

/**
 * A LIST of {severity, count}, not an object with one field per severity.
 * Five severities exist today; an object shape would duplicate the enum in a
 * second place, so a sixth would require changing two things and would be
 * invisible to any client not rebuilt. The list stays correct automatically
 * and matches how `ValidationDetailModal` actually renders — iterating
 * severities in `SEVERITY_ORDER`.
 *
 * Severities with no messages are OMITTED, not reported as 0 — see
 * `validation-counts-loader.ts` for why that mirrors REST exactly.
 */
export const model = builder
  .objectRef<ValidationSeverityCountShape>('ValidationSeverityCount')
  .implement({
    fields: (t) => ({
      severity: t.field({
        type: validationSeverity,
        resolve: (row) => row.severity as Severity,
      }),
      count: t.exposeInt('count'),
    }),
  });
