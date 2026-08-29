import { z } from 'zod';

import { getBookById, getSubjects } from '../../../../services/book-catalog';
import { analyzeEpub } from '../../../../services/epub-import-pipeline';
import type { ValidationMessage } from '../../../../services/epub-validator';
import { stagingIdentityOf } from '../../../../services/replace-staging';
import type { MetadataFix } from '../../../../types';
import { builder } from '../../builder';
import { model as epubValidationMessage } from '../../epub-validation-message';
import {
  invalidInputError,
  model as invalidInputErrorModel,
} from '../../invalid-input-error/model';
import { model as metadataFix } from '../../metadata-fix';
import { NO_MATCH_USER_ID, parseCompoundId } from '../../node-scope';
import {
  model as stagedUploadNotFoundErrorModel,
  stagedUploadNotFoundError,
} from '../../staged-upload-not-found-error/model';
import { model as book } from '../model';

/**
 * The `Book` global ID IS the input's `id` field — no separate `userId`/
 * `bookId` pair. Same shape as `bookValidate`'s `BookValidateInput` (see that
 * file's doc comment for the full rationale): the id's compound-key local
 * part already carries the owner, so decoding it at the resolver boundary
 * yields both halves the old two-argument shape used to require. This is
 * independent of who may consume the staged upload named by
 * `stagedUploadId` — that identity is always `context.viewer.userId`, the
 * literal authenticated caller, never the decoded owner. See the resolver's
 * doc comment for why the two can differ and what happens when they do.
 */
const input = builder.inputType('BookAnalyzeReplaceInput', {
  fields: (t) => ({
    id: t.globalID({ required: true, for: book }),
    stagedUploadId: t.string({ required: true }),
  }),
});

const inputSchema = z.object({
  stagedUploadId: z.string().min(1, 'stagedUploadId must not be empty'),
});

type BookAnalyzeReplacePayloadShape = {
  readonly __typename: 'BookAnalyzeReplacePayload';
  readonly valid: boolean;
  readonly messages: readonly ValidationMessage[];
  readonly autoFixes: readonly MetadataFix[];
  readonly proposals: readonly MetadataFix[];
};

/**
 * Plain data, not a fresh Prisma lookup like `BookUpdateMetadataPayload.book`
 * — there is nothing persisted to look up. `analyzeEpub` never creates or
 * modifies a `Book` row (its own doc comment); this mirrors
 * `POST /api/books/:id/replace/analyze`'s response body field-for-field,
 * minus `counts`/`threshold`, which `EpubValidationError` already
 * established as droppable — `counts` is derivable from `messages`.
 * `threshold` genuinely has no other reachable home for a candidate under
 * analysis: `Validation.threshold` only exists for an already-persisted
 * row (this candidate isn't one), and `Config` exposes only
 * `libraryName`/`maxConcurrentUploads` (corrected — an earlier draft of
 * this comment claimed the threshold was "already readable as `Config`",
 * which is false; review finding M-3). Dropped anyway, following the same
 * precedent `EpubValidationError` set: the single configured
 * `validationThreshold` rarely varies per request, so a client rendering
 * this payload doesn't lose anything actionable by not seeing it echoed
 * back.
 */
const payload = builder
  .objectRef<BookAnalyzeReplacePayloadShape>('BookAnalyzeReplacePayload')
  .implement({
    fields: (t) => ({
      valid: t.exposeBoolean('valid'),
      messages: t.field({ type: [epubValidationMessage], resolve: (parent) => parent.messages }),
      autoFixes: t.field({ type: [metadataFix], resolve: (parent) => parent.autoFixes }),
      proposals: t.field({ type: [metadataFix], resolve: (parent) => parent.proposals }),
    }),
  });

/**
 * No `resolveType`: every member value carries its own `__typename` — see
 * `progress/mutation/delete.ts`'s identical note.
 */
const result = builder.unionType('BookAnalyzeReplaceResult', {
  types: [payload, stagedUploadNotFoundErrorModel, invalidInputErrorModel],
});

/**
 * Mirrors `POST /api/books/:id/replace/analyze` (`routes/ui.ts:1316-1354`),
 * minus the multipart upload half — see `replace-staging.ts`'s doc comment
 * for the staged-upload design this and `bookReplace` share, adjudicated
 * 2026-08-01 to resolve the spec's binary-boundary self-conflict.
 *
 * Input is the `Book` global ID alone (design doc's 10-mutation input
 * collapse), decoded with the same `parseCompoundId`/`NO_MATCH_USER_ID`
 * convention `bookValidate` established — see that file's resolver doc
 * comment for the full malformed-id / wrong-type-id reasoning, which applies
 * here unchanged. `authScopes` runs `ownerOf` on the decoded userId, the
 * same way every sibling book mutation does; REST's "admin without a
 * target" 400 cannot occur here, since the decoded id always names a
 * specific owner rather than leaving one to be supplied separately.
 *
 * The staged file is resolved by a DIFFERENT identity —
 * `stagingIdentityOf(context.viewer)` (`services/replace-staging.ts`), never
 * the decoded owner of `id`. This is the spec's own rule ("keyed to the
 * *authenticated* user, not the `?user=` target") applied at the GraphQL
 * boundary: an admin session's `viewer.userId` is always `null`
 * (`context.ts`), so `stagingIdentityOf` maps it to `ADMIN_STAGING_ID`
 * instead — a distinct bucket from every real userId (Task 4), so an admin
 * CAN now stage and resolve its own upload, but still can never resolve one
 * staged by the very user `id` decodes to (or by any other user): staging
 * identity and book-targeting identity are deliberately different axes, and
 * this only widens the FIRST one to include admins, not merges the two.
 *
 * `analyzeEpub` (`services/epub-import-pipeline.ts`) never throws one of the
 * seven known store errors on this path: its own internal `assertValidEpub`
 * call catches exactly `EpubValidationError` and folds it into an in-band
 * `valid: false` result (never rethrown), and its `repairPackageDocument`
 * call is separately guarded with warn-and-continue. Nothing here is wrapped
 * in `toResult` — REST has no try/catch around this call either, so a
 * genuinely unexpected throw reaches yoga's masking exactly like REST's
 * fallback 500 would.
 *
 * Unlike the legacy route, `analyzeEpub` runs against the STAGED file path
 * directly, not a request-scoped tmp file — so its own repair-and-rewrite
 * step (when triggered) persists into the staged file rather than a
 * throwaway copy. This is deliberate, not drift: it is what lets a
 * following `bookReplace` call, against the same `stagedUploadId`, see
 * already-repaired bytes (its own repair pass is then idempotent). The
 * staged file is never consumed here — `resolve`, not `consume` — so the
 * same id remains usable for a follow-up `bookAnalyzeReplace` or `bookReplace`
 * call.
 */
builder.mutationField('bookAnalyzeReplace', (t) =>
  t.field({
    type: result,
    nullable: true,
    description:
      'Analyzes a staged EPUB as a candidate replacement for an existing ' +
      'book: validity, epubcheck findings, and detected metadata fixes. ' +
      'Read-only — the staged upload is not consumed. Resolves to null when ' +
      'the book does not exist for the resolved owner.',
    args: { input: t.arg({ type: input, required: true }) },
    authScopes: (_parent, args) => {
      const parsed = parseCompoundId(args.input.id.id);
      return { ownerOf: parsed === null ? NO_MATCH_USER_ID : parsed[0] };
    },
    resolve: async (_parent, args, context) => {
      const parsed = parseCompoundId(args.input.id.id);
      if (parsed === null) return null; // admin passed scope on a malformed id: same "no such row" convention
      const [userId, bookId] = parsed;

      const parsedInput = inputSchema.safeParse({ stagedUploadId: args.input.stagedUploadId });
      if (!parsedInput.success) return invalidInputError(parsedInput.error);

      const owner = await context.loadOwner(userId);
      if (owner === null) return null;

      const targetBook = await getBookById(context.prisma, context.config.booksDir, owner, bookId);
      if (targetBook === null) return null;

      const stagingIdentity = stagingIdentityOf(context.viewer!);
      // `'epub'` explicit (Task 3b generalized the registry to also hold
      // `'cover'`-kind entries): a `stagedUploadId` that names a staged
      // cover must fail here exactly like an unknown/foreign/expired id,
      // never be read as an EPUB candidate.
      const staged =
        stagingIdentity === null
          ? null
          : context.replaceStaging.resolve(
              parsedInput.data.stagedUploadId,
              stagingIdentity,
              'epub'
            );
      if (staged === null) return stagedUploadNotFoundError();

      const analysis = await analyzeEpub(staged.path, {
        originalName: staged.originalName,
        librarySubjects: await getSubjects(context.prisma, owner),
        validationThreshold: context.config.validationThreshold,
      });

      return {
        __typename: 'BookAnalyzeReplacePayload' as const,
        valid: analysis.valid,
        messages: analysis.report.messages,
        autoFixes: analysis.autoFixes,
        proposals: analysis.proposals,
      };
    },
  })
);
