import { builder } from '../builder';
import { model as userError } from '../user-error';

/**
 * The one honest member for "this staged-upload reference produced nothing"
 * — `bookAnalyzeReplace`/`bookReplace`'s `stagedUploadId` and (since Task 3b)
 * `bookUpdateMetadata`'s `stagedCoverId` all resolve through the same
 * `ReplaceStaging.resolve`/`consume` (`services/replace-staging.ts`), which
 * return `null` for FOUR distinct causes — unknown id, TTL-expired, staged
 * by a different user, and (since Task 3b's `StagedKind`) staged for a
 * different purpose (an EPUB id used as a cover reference, or vice versa) —
 * and this type deliberately cannot be told apart across any of them: the
 * spec's own "Replace staging" paragraph calls this out explicitly
 * ("indistinguishable across the three cases," written before the fourth
 * (kind) cause existed but the same reasoning covers it), for the same
 * reason `node-scope.ts`'s `NO_MATCH_USER_ID` doc comment gives for node
 * lookups — confirming which cause is true would leak information a denied
 * caller (most concretely: a viewer who guesses at or replays someone
 * else's staged-upload id) has no business learning.
 *
 * Carries no data beyond `message`, same as `SelfLinkError` — there is
 * nothing safe to attach: the id itself is the caller's own input (echoing
 * it back teaches them nothing), and any other field — including which of
 * the four causes applies — would start to discriminate the very cases this
 * type exists to keep indistinguishable.
 */
export type StagedUploadNotFoundErrorShape = {
  readonly __typename: 'StagedUploadNotFoundError';
  readonly message: string;
};

export const stagedUploadNotFoundError = (): StagedUploadNotFoundErrorShape => ({
  __typename: 'StagedUploadNotFoundError',
  message:
    'This staged upload was not found. It may be unknown, expired, staged by ' +
    'another user, or staged for a different purpose — upload the file again.',
});

export const model = builder
  .objectRef<StagedUploadNotFoundErrorShape>('StagedUploadNotFoundError')
  .implement({
    description:
      'The given staged-upload reference (stagedUploadId or stagedCoverId) does ' +
      'not resolve to a usable staged file — unknown, expired, staged by a ' +
      'different user, or staged for a different purpose (indistinguishable).',
    interfaces: [userError],
    fields: () => ({}),
  });
