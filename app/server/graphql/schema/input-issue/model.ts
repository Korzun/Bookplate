import { builder } from '../builder';

/**
 * One rejected input field, as `InvalidInputError.issues`.
 *
 * Derived from a zod issue, but deliberately only its two portable parts.
 * zod's own issue objects also carry `code`, `origin`, `minimum`, `inclusive`
 * and friends, whose names and membership are zod's implementation detail —
 * putting them in the SDL would make a zod upgrade a breaking schema change
 * for every client generated from it. `path` and `message` are what a form
 * needs to point at a field and say why.
 *
 * `path` is `[String!]!`: zod path segments are `PropertyKey`s (object keys
 * and array indices), stringified here so the SDL has one type rather than a
 * String/Int union.
 */
export type InputIssueShape = {
  readonly path: readonly string[];
  readonly message: string;
};

export const model = builder.objectRef<InputIssueShape>('InputIssue').implement({
  description: 'One rejected input value: where it was, and what was wrong with it.',
  fields: (t) => ({
    path: t.field({
      type: ['String'],
      description: 'Path to the offending value within the mutation input, outermost first.',
      resolve: (issue) => [...issue.path],
    }),
    message: t.exposeString('message'),
  }),
});
