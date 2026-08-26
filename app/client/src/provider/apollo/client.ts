import { ApolloClient, ApolloLink, HttpLink, InMemoryCache } from '@apollo/client';
import { getMainDefinition } from '@apollo/client/utilities';

import { ensureFreshToken } from '~/lib/api-fetch';

import { cacheConfig } from './cache';
import { createAuthLink, createRefreshLink } from './links';
import { SSELink } from './sse-link';

const isSubscription = (operation: Parameters<ApolloLink['request']>[0]): boolean => {
  const definition = getMainDefinition(operation.query);
  return definition.kind === 'OperationDefinition' && definition.operation === 'subscription';
};

/**
 * `refreshLink` BEFORE `authLink` so a retry re-reads the freshly stored token.
 *
 * Subscriptions bypass both: SSELink carries its own auth via `ensureFreshToken`
 * (graphql-sse's headers callback may be async), and the one-shot HTTP retry
 * has no meaning for a long-lived stream.
 *
 * No `credentials` option: everything is same-origin (the Vite dev proxy already
 * forwards `/graphql`), and the refresh call is plain REST outside Apollo.
 *
 * ---
 *
 * STANDING NOTE — `dataMasking` is deliberately NOT enabled (decided 2026-08-26).
 *
 * This was measured, not overlooked. Do not "just flip it": adding
 * `dataMasking: true` here breaks 71 tests across 20 files — one cluster, one
 * cause.
 *
 * **Why the flag alone does nothing good.** This codebase's `useFragment` is
 * graphql-codegen's, not Apollo's. All 26 call sites import it from `~/gql`,
 * and its generated implementation (`src/gql/fragment-masking.ts`) is
 * `return fragmentType as any` — a compile-time identity cast. `dataMasking: true` strips the masked fields out
 * of the query result, after which the cast faithfully returns the stripped
 * object and every colocated screen renders nothing. The flag removes the data;
 * nothing in this codebase puts it back.
 *
 * **What adopting it would actually take.** Converting all 26 sites to
 * Apollo's own `useFragment` (`@apollo/client/react`) — a DIFFERENT function: a
 * real hook, a different signature (`{ fragment, from }`), and a
 * `{ data, complete }` return shape, so every consumer's null/loading branch
 * changes — plus `@unmask` on the spreads whose target type the cache can never
 * identify. Two further calls live in test files
 * (`component/user-register/index.test.tsx`,
 * `lib/use-progress-mutations.test.tsx`) and would need converting for the
 * suite to compile; they are not part of the 26 because they ship nothing.
 *
 * **COUNTING TRAP — two ways to undercount these sites. Both have bitten.**
 * A naive `grep "useFragment("` misses sites by NAME and by LINE SPAN, and the
 * counts above were got wrong once by each:
 *
 *   1. ALIAS. `control/upload-replace-modal/use-replace-book.ts` has
 *      `import { useFragment as unmaskFragment } from '~/gql'`, so a grep for
 *      the literal name skips its two calls — a third of the unmaskable
 *      surface, in a file whose spreads are `MetadataFix`.
 *   2. MULTI-LINE. Four calls are formatted with the open paren ending the
 *      line and the fragment argument on the next one:
 *      `page/series/index.tsx:132` and
 *      `provider/upload/hook/use-upload-queue.ts:448,452,456`. A pattern
 *      expecting the argument on the SAME line drops all four silently —
 *      three of them `MetadataFix`, i.e. half the unmaskable surface again.
 *
 * Match the aliased name AND allow the call to span lines. Two people
 * undercounted this same figure by these two different mechanisms while
 * writing this note, which is why both are recorded rather than just the one.
 *
 * **The fail-open hazard — structural, not a bug awaiting a fix.** Apollo's
 * `useFragment` against an object with no `id` returns
 * `{ data: {}, complete: true }`: empty data, REPORTED COMPLETE, no error and
 * no warning. `MetadataFix` (5 spread sites across TWO files:
 * `provider/upload/hook/use-upload-queue.ts` and
 * `control/upload-replace-modal/use-replace-book.ts`) and `LinkedDocument`
 * (`control/book-lineage-modal`, 1 site) have no `id` in the SDL — `MetadataFix`'s own schema doc says it is "a detected issue,
 * regenerated per import, not a stored entity" — so they can NEVER be
 * normalized and this is permanent for them. Note that no test can catch it by
 * mutation: such a test does not stop discriminating a mutation, it stops
 * having a subject.
 *
 * **What the project relies on instead, and it does work.** Masking here is a
 * TYPE-level contract: codegen's `FragmentType` makes an undeclared field
 * unreadable, and `tsc --noEmit` (part of `npm run lint`) enforces it on every
 * run. That enforcement is pinned by two checked-in `@ts-expect-error`s, which
 * fail as "unused directive" the moment a ref stops being masked —
 * `page/series/index.test.tsx` (`book?.title`) and `page/book/index.test.tsx`
 * (`refs?.[0]?.timestamp`). Colocated fragments, the query-cost budgets and the
 * persisted-documents guardrails deliver this project's over-fetching
 * guarantees without runtime masking.
 */
export const createApolloClient = (): ApolloClient =>
  new ApolloClient({
    link: ApolloLink.split(
      isSubscription,
      new SSELink({ url: '/graphql', getToken: ensureFreshToken }),
      ApolloLink.from([createRefreshLink(), createAuthLink(), new HttpLink({ uri: '/graphql' })])
    ),
    cache: new InMemoryCache(cacheConfig),
  });
