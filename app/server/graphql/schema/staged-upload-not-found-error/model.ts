import { builder } from '../builder';
import { model as userError } from '../user-error';

/**
 * The one honest member for "this `stagedUploadId` produced nothing" —
 * `bookAnalyzeReplace`/`bookReplace`'s `ReplaceStaging.resolve`/`consume`
 * (`services/replace-staging.ts`) return `null` for three distinct causes
 * (unknown id, TTL-expired, staged by a different user) and this type
 * deliberately cannot be told apart across them: the spec's own "Replace
 * staging" paragraph calls this out explicitly ("indistinguishable across
 * the three cases"), for the same reason `node-scope.ts`'s `NO_MATCH_USER_ID`
 * doc comment gives for node lookups — confirming which of the three is true
 * would leak information a denied caller (most concretely: a viewer who
 * guesses at or replays someone else's `stagedUploadId`) has no business
 * learning.
 *
 * Carries no data beyond `message`, same as `SelfLinkError` — there is
 * nothing safe to attach: the id itself is the caller's own input (echoing
 * it back teaches them nothing), and any other field would start to
 * discriminate the very cases this type exists to keep indistinguishable.
 */
export type StagedUploadNotFoundErrorShape = {
  readonly __typename: 'StagedUploadNotFoundError';
  readonly message: string;
};

export const stagedUploadNotFoundError = (): StagedUploadNotFoundErrorShape => ({
  __typename: 'StagedUploadNotFoundError',
  message:
    'This staged upload was not found. It may be unknown, expired, or staged by another user — upload the file again.',
});

export const model = builder
  .objectRef<StagedUploadNotFoundErrorShape>('StagedUploadNotFoundError')
  .implement({
    description:
      'The given stagedUploadId does not resolve to a usable staged file — ' +
      'unknown, expired, or staged by a different user (indistinguishable).',
    interfaces: [userError],
    fields: () => ({}),
  });
