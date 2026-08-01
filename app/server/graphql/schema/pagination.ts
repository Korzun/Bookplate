import { GraphQLError } from 'graphql';

/**
 * `t.connection` always adds `last`/`before` to the SDL (they are baked into
 * Pothos's `DefaultConnectionArguments`), but every paginated read in this
 * schema delegates to a store method with a single forward keyset cursor —
 * `BookStore.listBooksPage` and `UserStore.getUserProgressPage` both take one
 * cursor plus a `take` and have no keyset to walk backward from. Bolting one
 * on would mean changing stores this migration has kept untouched.
 *
 * Silently ignoring `last`/`before` would mean a client asking for the
 * trailing page instead gets the *leading* page with no error, which is worse
 * than not offering backward pagination at all — so both are rejected loudly,
 * in the same `extensions.code` + `extensions.http.status` shape `builder.ts`'s
 * `unauthorizedError` uses, so a client branches on `code` rather than parsing
 * English.
 *
 * Shared rather than copied: `Library.entries` was the only connection when
 * this rule was written, `Library.progress` is the second, and two copies of a
 * pagination guard that can silently diverge is the pattern this plan has
 * repeatedly extracted rather than duplicated.
 */
export const rejectBackwardPagination = (
  fieldName: string,
  args: { last?: number | null; before?: string | null }
): void => {
  // Each condition is checked independently: `last` alone and `before` alone
  // must both be rejected, which an `&&` between them would not do.
  if (args.last == null && args.before == null) return;
  throw new GraphQLError(
    `${fieldName} only supports forward pagination — use \`first\`/\`after\`, not \`last\`/\`before\`.`,
    { extensions: { code: 'BACKWARD_PAGINATION_UNSUPPORTED', http: { status: 400 } } }
  );
};
