import type { ZodError } from 'zod';

import { builder } from '../builder';
import { model as inputIssue, type InputIssueShape } from '../input-issue';
import { model as userError } from '../user-error';

/**
 * The one error type in this family that no store throws: it is produced by a
 * resolver's own zod parse of its input.
 *
 * WHY A UNION MEMBER RATHER THAN THE VALIDATION PLUGIN'S ARG OPTION: surfacing
 * `@pothos/plugin-validation` failures through the errors plugin needs
 * `unsafelyHandleInputErrors`, which that plugin's own README says bypasses
 * other plugins' hooks — scope-auth's included. That would mean input errors
 * are computed and returned for requests that were never authorized. So every
 * mutation parses its input INSIDE the resolver, after auth, and returns this
 * as an ordinary member of its result union (spec, phase-1 outcome, resolved
 * open question #2). Do not "simplify" this back to declarative arg
 * validation.
 *
 * `message` is a fixed summary rather than zod's flattened prose: the detail
 * belongs in `issues`, addressed by `path`, so a client can attach each one to
 * the field it came from.
 */
export type InvalidInputErrorShape = {
  readonly __typename: 'InvalidInputError';
  readonly message: string;
  readonly issues: readonly InputIssueShape[];
};

export const invalidInputError = (error: ZodError): InvalidInputErrorShape => ({
  __typename: 'InvalidInputError',
  message: 'Invalid input',
  issues: error.issues.map((issue) => ({
    path: issue.path.map((segment) => String(segment)),
    message: issue.message,
  })),
});

export const model = builder.objectRef<InvalidInputErrorShape>('InvalidInputError').implement({
  description: 'The mutation input did not pass validation; nothing was changed.',
  interfaces: [userError],
  fields: (t) => ({
    issues: t.field({
      type: [inputIssue],
      resolve: (error) => error.issues,
    }),
  }),
});
