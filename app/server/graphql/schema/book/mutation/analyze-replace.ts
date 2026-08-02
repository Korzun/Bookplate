import { z } from 'zod';

import { analyzeEpub } from '../../../../services/epub-import-pipeline';
import type { ValidationMessage } from '../../../../services/epub-validator';
import type { MetadataFix } from '../../../../types';
import { builder } from '../../builder';
import { model as epubValidationMessage } from '../../epub-validation-message';
import {
  invalidInputError,
  model as invalidInputErrorModel,
} from '../../invalid-input-error/model';
import { model as metadataFix } from '../../metadata-fix';
import { NO_MATCH_USER_ID } from '../../node-scope';
import {
  model as stagedUploadNotFoundErrorModel,
  stagedUploadNotFoundError,
} from '../../staged-upload-not-found-error/model';
import { model as user } from '../../user/model';

/**
 * `userId` is optional, unlike every other book mutation's required
 * `userId: ID!` — adjudicated 2026-08-01 alongside the staged-upload design
 * (see `replace-staging.ts`'s doc comment). It resolves which library's book
 * is being replaced (`ownerOf`-scoped, same admin-targeting shape as every
 * sibling), which is independent of who may consume the staged upload named
 * by `stagedUploadId` — that identity is always `context.viewer.userId`, the
 * literal authenticated caller, never this field. See the resolver's doc
 * comment for why the two can differ and what happens when they do.
 */
const input = builder.inputType('BookAnalyzeReplaceInput', {
  fields: (t) => ({
    userId: t.globalID({ required: false, for: user }),
    bookId: t.string({ required: true }),
    stagedUploadId: t.string({ required: true }),
  }),
});

/**
 * `userId` is validated here too (not just typed as an optional `ID`):
 * REST's `resolveOwner` 400s an admin session that names no target
 * (`routes/ui.ts:148-169`, "user query parameter is required for admin
 * sessions") — mirrored as an honest `InvalidInputError` rather than
 * silently falling back to some default, since an admin viewer has no
 * library of its own to fall back to. A non-admin session never trips this:
 * its `userId` defaults to its own, always a real string (`Viewer.userId` is
 * only ever `null` for the config-based admin — `context.ts`'s doc comment).
 */
const buildInputSchema = (viewerIsAdmin: boolean) =>
  z
    .object({
      bookId: z.string().min(1, 'bookId must not be empty'),
      stagedUploadId: z.string().min(1, 'stagedUploadId must not be empty'),
      userId: z.string().nullable(),
    })
    .superRefine((value, ctx) => {
      if (viewerIsAdmin && value.userId === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['userId'],
          message: 'userId is required for admin sessions',
        });
      }
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
 * Owner resolution (which library's `Book` this targets) mirrors every
 * sibling book mutation's `ownerOf`-scoped shape, except `userId` is
 * optional: a viewer who omits it edits their own library (`context.viewer.
 * userId`), and an admin MUST name one (`buildInputSchema`'s `superRefine`)
 * — REST's `resolveOwner` 400, otherwise unreachable here since `ownerOf`
 * itself never blocks an admin regardless of what (or whether) `userId` was
 * supplied (`isOwnerOrAdmin` short-circuits on `viewer.isAdmin` — see
 * `node-scope.ts`).
 *
 * The staged file is resolved by a DIFFERENT identity — `context.viewer.
 * userId`, the literal authenticated caller — never the resolved book
 * owner. This is the spec's own rule ("keyed to the *authenticated* user,
 * not the `?user=` target") applied at the GraphQL boundary: an admin
 * session's `viewer.userId` is always `null` (`context.ts`), and
 * `ReplaceStaging.resolve` never has a `null`-keyed entry to find (nothing
 * can stage one — `POST /api/books/replace-staging` 401s an admin session
 * outright, see that route's doc comment), so an admin can never
 * successfully resolve ANY staged upload, including one staged by the very
 * user it names as `userId`. That is intentional, not a gap: staging
 * ownership and book ownership are deliberately different axes.
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
    authScopes: (_parent, args, context) => ({
      ownerOf: args.input.userId?.id ?? context.viewer?.userId ?? NO_MATCH_USER_ID,
    }),
    resolve: async (_parent, args, context) => {
      const parsed = buildInputSchema(context.viewer?.isAdmin === true).safeParse({
        bookId: args.input.bookId,
        stagedUploadId: args.input.stagedUploadId,
        userId: args.input.userId?.id ?? null,
      });
      if (!parsed.success) return invalidInputError(parsed.error);

      const targetUserId = parsed.data.userId ?? context.viewer!.userId!;
      const owner = await context.loadOwner(targetUserId);
      if (owner === null) return null;

      const targetBook = await context.stores.book.getBookById(owner, parsed.data.bookId);
      if (targetBook === null) return null;

      const callerUserId = context.viewer!.userId;
      // `'epub'` explicit (Task 3b generalized the registry to also hold
      // `'cover'`-kind entries): a `stagedUploadId` that names a staged
      // cover must fail here exactly like an unknown/foreign/expired id,
      // never be read as an EPUB candidate.
      const staged =
        callerUserId === null
          ? null
          : context.stores.replaceStaging.resolve(parsed.data.stagedUploadId, callerUserId, 'epub');
      if (staged === null) return stagedUploadNotFoundError();

      const analysis = await analyzeEpub(staged.path, {
        originalName: staged.originalName,
        librarySubjects: await context.stores.book.getSubjects(owner),
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
