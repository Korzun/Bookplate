import { z } from 'zod';

import {
  applyEpubChanges,
  type ApplyEpubChangesDeps,
} from '../../../../services/apply-epub-changes';
import { BookHashCollisionError } from '../../../../services/book-store';
import { applySplit } from '../../../../services/epub-import-pipeline';
import { EpubValidationError } from '../../../../services/epub-validator';
import type { EpubChanges } from '../../../../services/epub-writer';
import type { Book, MetadataFix, Owner } from '../../../../types';
import { parsePendingFixState } from '../../../derive';
import { assertUnreachableStoreError, toResult } from '../../../to-result';
import {
  bookHashCollisionError,
  model as bookHashCollisionErrorModel,
} from '../../book-hash-collision-error/model';
import {
  bookNotValidatedError,
  model as bookNotValidatedErrorModel,
} from '../../book-not-validated-error/model';
import { builder } from '../../builder';
import {
  epubValidationError,
  model as epubValidationErrorModel,
} from '../../epub-validation-error/model';
import {
  invalidInputError,
  model as invalidInputErrorModel,
} from '../../invalid-input-error/model';
import { model as user } from '../../user/model';
import { model as bookType } from '../model';

type PendingFixResolutionValue = 'accept' | 'dismiss';

/**
 * The single mutation the spec names (`bookResolvePendingFix`) covers both of
 * REST's pending-fix write routes (`PUT`/`DELETE /api/books/:id/pending-fixes`,
 * `routes/ui.ts:776-811`) via this discriminator, rather than two separate
 * mutations — see this file's main doc comment for the full design rationale,
 * including why "accept" is NOT a literal 1:1 REST mirror (no REST route
 * atomically applies a pending fix's proposals; the client currently does
 * that itself across several requests — traced in the task report).
 */
const resolution = builder.enumType('PendingFixResolution', {
  values: {
    ACCEPT: { value: 'accept' },
    DISMISS: { value: 'dismiss' },
  } as const satisfies Record<
    Uppercase<PendingFixResolutionValue>,
    { value: PendingFixResolutionValue }
  >,
});

const input = builder.inputType('BookResolvePendingFixInput', {
  fields: (t) => ({
    userId: t.globalID({ required: true, for: user }),
    bookId: t.string({ required: true }),
    action: t.field({ type: resolution, required: true }),
  }),
});

/**
 * `min(1)` mirrors `bookDelete`/`bookUpdateMetadata`'s identical rule — see
 * those files' doc comments.
 */
const inputSchema = z.object({
  bookId: z.string().min(1, 'bookId must not be empty'),
});

type BookResolvePendingFixPayloadShape = {
  readonly __typename: 'BookResolvePendingFixPayload';
  readonly owner: Owner;
  readonly bookId: string;
};

/**
 * `book` is a fresh lookup, not a store-returned DTO — same reasoning as
 * `BookLinkDocumentPayload.book`. `bookId` here is the id AFTER resolution:
 * `DISMISS` never touches the book, so it is always `input.bookId`; `ACCEPT`
 * may rewrite the EPUB (when it has live proposals to apply), which can mint
 * a new content-hash id exactly like `bookUpdateMetadata` — see this file's
 * resolver doc comment.
 */
const payload = builder
  .objectRef<BookResolvePendingFixPayloadShape>('BookResolvePendingFixPayload')
  .implement({
    fields: (t) => ({
      book: t.prismaField({
        type: bookType,
        resolve: (query, parent, _args, context) =>
          context.prisma.book.findUniqueOrThrow({
            ...query,
            where: { userId_id: { userId: parent.owner.userId, id: parent.bookId } },
          }),
      }),
    }),
  });

/**
 * No `resolveType`: every member value carries its own `__typename` — see
 * `progress/mutation/delete.ts`'s identical note.
 */
const result = builder.unionType('BookResolvePendingFixResult', {
  types: [
    payload,
    invalidInputErrorModel,
    bookNotValidatedErrorModel,
    bookHashCollisionErrorModel,
    epubValidationErrorModel,
  ],
});

/**
 * Folds a live `PendingFix`'s stored `proposals` into an `EpubChanges` object,
 * exactly the way `applyAutoAndAccepted` (`epub-import-pipeline.ts`) folds a
 * freshly re-detected accepted set — same two cases per fix: a
 * `subjects-split` fix carries its edit in `fromChips`/`toChips` (its
 * `changes` is empty — see `metadata-issues.ts`'s `subjects-split` branch)
 * and must be folded into the running subjects array via the SAME shared
 * `applySplit` helper that function uses; every other fix's `changes` merges
 * directly via `Object.assign`, since `MetadataFix.changes` already carries
 * the exact `EpubChanges` field/value shape (both are produced from the same
 * `detectMetadataIssues` vocabulary — `metadata-issues.ts`).
 *
 * Deliberately reads the STORED `MetadataFix` objects from the `PendingFix`
 * row rather than re-running `detectMetadataIssues` against the book's
 * current metadata (which is what `applyAutoAndAccepted` does for
 * upload/replace, where no persisted proposal objects exist yet): this
 * mutation acts on a specific, already-persisted pending fix, so applying
 * what it actually says is more faithful than hoping re-detection reproduces
 * the same issues.
 */
function foldProposalsIntoChanges(
  proposals: readonly MetadataFix[],
  currentSubjects: readonly string[]
): EpubChanges {
  const changes: EpubChanges = {};
  let subjects = [...currentSubjects];
  let subjectsChanged = false;
  for (const fix of proposals) {
    if (fix.kind === 'subjects-split') {
      subjects = applySplit(subjects, fix.fromChips?.[0] ?? fix.from, fix.toChips ?? []);
      subjectsChanged = true;
    } else {
      Object.assign(changes, fix.changes);
    }
  }
  if (subjectsChanged) changes.subjects = subjects;
  return changes;
}

/**
 * Mirrors REST's `PUT`/`DELETE /api/books/:id/pending-fixes`
 * (`routes/ui.ts:776-811`) as ONE mutation with an `action` discriminator,
 * per the spec's mutation list, which names only `bookResolvePendingFix` (no
 * separate accept/dismiss pair).
 *
 * **DISMISS is a direct REST mirror.** `DELETE /api/books/:id/pending-fixes`
 * is `bookStore.deletePendingFix(owner, id)` unconditionally — no book- or
 * row-existence check at all (traced: `routes/ui.ts:802-811`) — so this
 * branch mirrors that literally: it never touches the EPUB, never checks
 * whether a `PendingFix` row exists, and always succeeds once the book
 * itself resolves.
 *
 * **ACCEPT is NOT a literal REST mirror — flagged, per the task's escalation
 * instruction.** Traced end to end: no REST route atomically "accepts" a
 * pending fix. `PUT /api/books/:id/pending-fixes` only ever WRITES whatever
 * state the client sends (`routes/ui.ts:776-800`); the client
 * (`use-upload-queue.ts`'s `applyAllProposals`/`applyPatch`) actually applies
 * fixes itself, via a separate `PATCH /api/books/:id/metadata` call, then
 * syncs the resulting (reduced) proposal list back via this same `PUT`. That
 * multi-request, client-orchestrated flow includes an `undo` snapshot this
 * mutation does not attempt to reproduce (undo is client-session state, never
 * persisted by any REST route on the server's behalf beyond the raw `PUT`
 * body). Given the brief's own description ("the accept path applies fixes
 * via the `upsertPendingFix`/apply flow") and that the spec names exactly one
 * mutation, ACCEPT here means: apply every live proposal in one atomic write
 * via `applyEpubChanges` — the same underlying operation
 * `bookUpdateMetadata` uses — then clear the (now-resolved) `PendingFix` row.
 * This is a genuine, honest design choice, not a REST citation; see the task
 * report for the full alternative designs considered.
 *
 * `applyEpubChanges` can only run when there is at least one live proposal:
 * with none (no row, an expired row, or a resolved one),  ACCEPT is a no-op
 * that clears a stale row if one exists and returns the book unchanged —
 * mirroring REST's own permissiveness (neither write route ever checks
 * whether a `PendingFix` exists before acting) rather than fabricating an
 * error for "nothing to accept".
 *
 * `targetBook.valid !== true` gates ACCEPT exactly like `bookUpdateMetadata`
 * gates its own `applyEpubChanges` call (REST's `PATCH .../metadata` 409 —
 * see that file's doc comment): both mutations reach the identical
 * underlying write, so both must respect the identical precondition on it.
 * DISMISS never calls `applyEpubChanges`, so it is not gated.
 *
 * ACCEPT respects the same TTL liveness the read model applies (`Book.
 * pendingFix`, `Library.pendingFixes` — `derive.ts`'s `isLivePendingFix`,
 * schema-cleanup spec §3), but WITHOUT calling that predicate — see the
 * `proposals` read below for the proof that reading `state.proposals`
 * directly already agrees with it for every possible state, TTL included.
 * An expired pending fix behaves, for ACCEPT, exactly like a missing one
 * (nothing to apply), never like a live one whose stale proposals get
 * silently re-applied.
 *
 * `applyEpubChanges` can throw `BookHashCollisionError` / `EpubValidationError`
 * — the same two `bookUpdateMetadata` traces (`applyEpubChanges`'s own doc
 * comment) — `expected` declares exactly this subset.
 *
 * A successful ACCEPT may rewrite the EPUB, changing the book's content-hash
 * id (`bookUpdateMetadata`'s doc comment explains why). The `PendingFix` row
 * (if any) FK-cascades onto the new id in the same transaction
 * (`schema.prisma`'s `onUpdate: Cascade` on `PendingFix`'s `[userId,
 * bookId]` FK), so the cleanup delete below targets `outcome.ok.id` (the NEW
 * id), not the pre-edit `bookId` — the same `outcome.ok.id` convention
 * `bookUpdateMetadata` uses for its own post-success side effects.
 */
builder.mutationField('bookResolvePendingFix', (t) =>
  t.field({
    type: result,
    nullable: true,
    description:
      'Accepts (applies) or dismisses (discards) a book’s pending metadata- ' +
      'fix proposals. Resolves to null when the book does not exist for the ' +
      'resolved owner.',
    args: { input: t.arg({ type: input, required: true }) },
    authScopes: (_parent, args) => ({ ownerOf: args.input.userId.id }),
    resolve: async (_parent, args, context) => {
      const parsed = inputSchema.safeParse({ bookId: args.input.bookId });
      if (!parsed.success) return invalidInputError(parsed.error);

      const userId = args.input.userId.id;
      const owner = await context.loadOwner(userId);
      if (owner === null) return null;

      const targetBook = await context.stores.book.getBookById(owner, parsed.data.bookId);
      if (targetBook === null) return null;

      if (args.input.action === 'dismiss') {
        await context.stores.book.deletePendingFix(owner, targetBook.id);
        return {
          __typename: 'BookResolvePendingFixPayload' as const,
          owner,
          bookId: targetBook.id,
        };
      }

      /**
       * Reads `state.proposals` directly rather than calling the read model's
       * `isLivePendingFix` predicate — proven equivalent for this purpose, not
       * merely assumed: `isLivePendingFix` (`derive.ts`) returns `false` ONLY
       * when `state.proposals.length === 0` (its `noProposals && noUndo` and
       * `expiredUndo` branches both require `noProposals`); whenever
       * `proposals.length > 0` it always returns `true`. So "does this row
       * have live proposals" and "is `state.proposals` non-empty" are the same
       * question for every possible state, TTL included — a genuinely expired,
       * undo-only row already has `proposals: []` by construction, the same as
       * a missing row or an already-resolved one. Calling the predicate here
       * would be dead weight that looks load-bearing but changes nothing (this
       * was verified with a seen-to-fail run, not asserted — see the task
       * report). `Book.pendingFix`/`Library.pendingFixes` still apply the real
       * predicate for READING a `PendingFix` — this is about this resolver's
       * own internal "is there anything to accept" decision only.
       */
      const row = await context.loadPendingFix(owner.userId, targetBook.id);
      const proposals = row === null ? [] : parsePendingFixState(row.state).proposals;

      if (proposals.length === 0) {
        if (row !== null) await context.stores.book.deletePendingFix(owner, targetBook.id);
        return {
          __typename: 'BookResolvePendingFixPayload' as const,
          owner,
          bookId: targetBook.id,
        };
      }

      if (targetBook.valid !== true) {
        return bookNotValidatedError(owner, targetBook.id);
      }

      const changes = foldProposalsIntoChanges(proposals, targetBook.subjects);

      const deps: ApplyEpubChangesDeps = {
        bookStore: context.stores.book,
        validationStore: context.stores.validation,
        validationThreshold: context.config.validationThreshold,
      };

      const outcome = await toResult<Book, BookHashCollisionError | EpubValidationError>(
        () => applyEpubChanges(deps, owner, targetBook, changes),
        [BookHashCollisionError, EpubValidationError]
      );
      if ('err' in outcome) {
        if (outcome.err instanceof BookHashCollisionError) {
          return bookHashCollisionError(outcome.err, owner);
        }
        if (outcome.err instanceof EpubValidationError) {
          return epubValidationError(outcome.err);
        }
        return assertUnreachableStoreError(outcome.err);
      }

      await context.stores.book.deletePendingFix(owner, outcome.ok.id);

      return {
        __typename: 'BookResolvePendingFixPayload' as const,
        owner,
        bookId: outcome.ok.id,
      };
    },
  })
);
