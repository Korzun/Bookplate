import { epochToDate } from '../../derive';
import { builder } from '../builder';
import { model as validationThreshold } from '../validation-threshold';

type ValidationThresholdValue = 'NONE' | 'FATAL' | 'ERROR' | 'WARNING' | 'INFO' | 'USAGE';

/**
 * Deliberately a prismaObject, not a prismaNode. A Validation is only ever
 * reached through its Book, so giving it a global ID would add a second,
 * separately-guarded door to tenant-owned data for no client benefit —
 * Houdini normalizes it under its parent.
 */
export const model = builder.prismaObject('Validation', {
  fields: (t) => ({
    valid: t.exposeBoolean('valid'),
    threshold: t.field({
      type: validationThreshold,
      resolve: (validation) => validation.threshold as ValidationThresholdValue,
    }),
    validatedAt: t.field({
      type: 'DateTime',
      resolve: (validation) => epochToDate(validation.validatedAt),
    }),
    messages: t.relation('messages', { query: { orderBy: { seq: 'asc' } } }),
  }),
});
