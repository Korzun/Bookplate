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
// `../../library/model`, not `../../library` — same "entity index must not be
// pulled in from a model file" reason `library/model.ts`'s own note gives for
// its `../book/model`/`../progress/model` imports. `book/mutation/delete.ts`
// is the precedent for this exact cross-directory import (`BookDeletePayload.
// library`).
import { model as library } from '../../library/model';
import { NO_MATCH_USER_ID, parseCompoundId } from '../../node-scope';
import { model as resolution } from '../../pending-fix-resolution';
import { model as bookType } from '../model';

/**
 * The `Book` global ID IS the input, alongside `action` — no separate
 * `userId`/`bookId` pair. Same shape as `bookValidate`'s `BookValidateInput`
 * (see that file's doc comment for the full rationale): the id's compound-key
 * local part already carries the owner, so decoding it at the resolver
 * boundary yields both halves the old two-argument shape used to require.
 */
const input = builder.inputType('BookResolvePendingFixInput', {
  fields: (t) => ({
    id: t.globalID({ required: true, for: bookType }),
    action: t.field({ type: resolution, required: true }),
  }),
});

type BookResolvePendingFixPayloadShape = {
  readonly __typename: 'BookResolvePendingFixPayload';
  readonly owner: Owner;
  readonly bookId: string;
};

/**
 * `book` is a fresh lookup, not a store-returned DTO — same reasoning as
 * `BookLinkDocumentPayload.book`. `bookId` here is the id AFTER resolution:
 * `DISMISS` never touches the book, so it is always the decoded input id's
 * local part; `ACCEPT` may rewrite the EPUB (when it has live proposals to
 * apply), which can mint a new content-hash id exactly like
 * `bookUpdateMetadata` — see this file's resolver doc comment.
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
      /**
       * Traced (schema-design review S1): this mutation resolves or discards
       * the book's `PendingFix` row, which is exactly what `Library.
       * pendingFixes` (the nav badge) reads. Without this field a cache has
       * no way to update that list in place — `Library`'s global id is keyed
       * on its owner's raw `userId` (`library/model.ts`), which is NOT
       * decodable from `book` alone without re-parsing `Book`'s own compound
       * id, so unlike the four Viewer-touching gaps traced as honest no-ops
       * elsewhere in this task (`Viewer` is a fixed, keyFields-less
       * singleton a client can always address without help), a per-tenant
       * `Library` genuinely needs to be handed over. Same construction
       * `BookDeletePayload.library` uses (`delete.ts`) — `owner` is already
       * on this payload's own shape, so this costs nothing extra to resolve.
       */
      library: t.field({ type: library, resolve: (result) => result.owner }),
    }),
  });

/**
 * No `resolveType`: every member value carries its own `__typename` — see
 * `progress/mutation/delete.ts`'s identical note.
 *
 * No `InvalidInputError` member: `bookId` was this file's only zod-validated
 * field, and it is gone now that the id arrives pre-decoded from the `Book`
 * global ID — malformed/wrong-type rejection of THAT happens entirely at the
 * relay arg layer, exactly like `bookValidate` (see that file's field doc
 * comment). `action` needs no zod either: it is a GraphQL enum
 * (`pending-fix-resolution.ts`'s `resolution` type), so an invalid value is
 * rejected by GraphQL's own argument coercion before the resolver runs, the
 * same way any other enum-typed arg in this schema is. With no zod schema
 * left in this file to make `InvalidInputError` reachable, the traced-union-
 * drop rule (design doc's "Discovered consequence") requires dropping it.
 */
const result = builder.unionType('BookResolvePendingFixResult', {
  types: [
    payload,
    bookNotValidatedErrorModel,
    bookHashCollisionErrorModel,
    epubValidationErrorModel,
  ],
});

/**
 * Folds a set of ACTIONABLE `MetadataFix` proposals into an `EpubChanges`
 * object, exactly the way `applyAutoAndAccepted` (`epub-import-pipeline.ts`)
 * folds a freshly re-detected accepted set — same two cases per fix: a
 * `subjects-split` fix carries its edit in `fromChips`/`toChips` (its
 * `changes` is empty — see `metadata-issues.ts`'s `subjects-split` branch)
 * and must be folded into the running subjects array via the SAME shared
 * `applySplit` helper that function uses; every other fix's `changes` merges
 * directly via `Object.assign`, since `MetadataFix.changes` already carries
 * the exact `EpubChanges` field/value shape (both are produced from the same
 * `detectMetadataIssues` vocabulary — `metadata-issues.ts`).
 *
 * "Actionable" is the caller's job, not this function's: see the resolver's
 * `actionable` filter below (`fix.to !== null`, review I-2) — this function
 * assumes it has already been applied and folds whatever it is given.
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
 * instruction — but IS designed to be behaviourally EQUIVALENT to what REST's
 * client actually persists**, traced end to end
 * (`app/client/src/provider/book/hook/use-upload-queue.ts:356-447`) after a
 * review round (task-4-review.md, findings I-1/I-2) found the first version
 * diverged from it in two ways. No REST route atomically "accepts" a pending
 * fix: `PUT /api/books/:id/pending-fixes` only ever WRITES whatever state the
 * client sends (`routes/ui.ts:776-800`); the client's `applyAllProposals` /
 * `applyPatch` actually applies fixes itself via a separate `PATCH
 * /api/books/:id/metadata` call, then a separate sync effect PUTs the
 * resulting reduced state back. Given the brief's own description ("the
 * accept path applies fixes via the `upsertPendingFix`/apply flow") and that
 * the spec names exactly one mutation, ACCEPT here means: apply every
 * ACTIONABLE proposal in one atomic write via `applyEpubChanges` — the same
 * underlying operation `bookUpdateMetadata` uses — then persist the same
 * post-accept `PendingFix` state the client's flow would have left behind.
 * This is a genuine, honest design choice, not a REST citation; see the task
 * report for the full alternative designs considered.
 *
 * **Actionable, not merely present (review I-2).** REST's client filters
 * `proposals.filter(p => p.to !== null)` before applying
 * (`use-upload-queue.ts:421`) and returns early — no PATCH at all — when that
 * filtered set is empty (`:422`). Two detected issue kinds are advisory-only
 * (`html-entity`, `title-is-filename` — `metadata-issues.ts`): they carry
 * `to: null` and an empty `changes`, so folding them changes nothing, yet
 * `applyEpubChanges` would still rebuild/revalidate/re-import the EPUB for
 * that no-op, minting a pointless new content-hash id. This resolver filters
 * to `actionable = proposals.filter(fix => fix.to !== null)` for the exact
 * same reason, BEFORE deciding whether there is anything to do.
 *
 * **No actionable proposals (no row, a resolved row, an expired undo-only
 * row, or a row whose only proposals are advisory) → ACCEPT is a strict
 * no-op**: no `applyEpubChanges` call, no `PendingFix` write of any kind
 * (neither upsert nor delete) — mirroring REST's client exactly, which does
 * not even issue a request in this case, rather than fabricating an error for
 * "nothing to accept". This intentionally happens BEFORE the
 * `targetBook.valid !== true` gate below (review M-7): since nothing would be
 * written either way, gating first would only turn a harmless no-op into a
 * confusing `BookNotValidatedError` for a book whose metadata was never
 * going to change.
 *
 * `targetBook.valid !== true` gates ACCEPT exactly like `bookUpdateMetadata`
 * gates its own `applyEpubChanges` call (REST's `PATCH .../metadata` 409 —
 * see that file's doc comment): both mutations reach the identical
 * underlying write, so both must respect the identical precondition on it —
 * but only once there is at least one actionable proposal to apply. DISMISS
 * never calls `applyEpubChanges`, so it is not gated.
 *
 * ACCEPT respects the same TTL liveness the read model applies (`Book.
 * pendingFix`, `Library.pendingFixes` — `derive.ts`'s `isLivePendingFix`,
 * schema-cleanup spec §3), but WITHOUT calling that predicate — see the
 * `actionable` computation below for the proof that reading `state.proposals`
 * directly already agrees with it for the "is there a row worth reading"
 * question, for every possible state, TTL included: a genuinely expired,
 * undo-only row already has `proposals: []` by construction, so it falls into
 * the no-op branch the same as a missing or already-resolved row — whether
 * any of those proposals turn out to be *actionable* is an orthogonal
 * question `isLivePendingFix` was never trying to answer.
 *
 * `applyEpubChanges` can throw `BookHashCollisionError` / `EpubValidationError`
 * — the same two `bookUpdateMetadata` traces (`applyEpubChanges`'s own doc
 * comment) — `expected` declares exactly this subset. A typed failure leaves
 * the `PendingFix` row untouched, same as every other typed-failure branch in
 * this schema (`bookUpdateMetadata`'s identical rule).
 *
 * **Persisted state on success mirrors what the client's `applyAllProposals`
 * + sync effect actually write (review I-1), not a delete.** The client
 * removes only the applied (actionable) fixes' keys from `proposals`
 * (`applyPatch`, `use-upload-queue.ts:384-396`) — any advisory-only proposals
 * that were never actionable are left behind — appends the applied fixes to
 * `appliedFixes`, and arms `undo: { kind: 'apply', proposals: <the FULL
 * pre-accept proposals list>, appliedFixes: <the pre-accept appliedFixes> }`
 * (`applyAllProposals`, `:427-443`); only THEN does the sync effect PUT that
 * state (`:207-229`) — it never deletes here, since `undo` is always set.
 * This resolver reproduces exactly that shape via `upsertPendingFix`, keyed
 * to `outcome.ok.id` (see below for why). Because `undo` is always non-null
 * on this path, `upsertPendingFix`'s own "resolved ⟹ delete" rule
 * (`book-store.ts:661-665`) never fires here — the row survives, live, for
 * the client's existing undo affordance to keep working after a
 * GraphQL-driven accept, exactly as it would after REST's.
 *
 * A successful ACCEPT may rewrite the EPUB, changing the book's content-hash
 * id (`bookUpdateMetadata`'s doc comment explains why). The `PendingFix` row
 * (read further above, before the write) FK-cascades onto the new id in the
 * same transaction (`schema.prisma`'s `onUpdate: Cascade` on `PendingFix`'s
 * `[userId, bookId]` FK), so the `upsertPendingFix` call below targets
 * `outcome.ok.id` (the NEW id), not the pre-edit `bookId` — the same
 * `outcome.ok.id` convention `bookUpdateMetadata` uses for its own
 * post-success side effects — and lands on the row the cascade already moved
 * there.
 *
 * The pre-write read uses `context.prisma.pendingFix.findUnique` directly,
 * NOT `context.loadPendingFix` (review M-1): that loader is a request-scoped
 * DataLoader shared with `Book.pendingFix`'s field resolver, so priming it
 * here under the pre-accept id and then writing straight to the database
 * (bypassing the loader) would leave a stale cached value behind for any
 * later read of `Book.pendingFix` on the same id within this request — an
 * unbatched, one-off mutation read has no batching benefit to lose by going
 * straight to Prisma instead.
 *
 * Input is the `Book` global ID plus `action` (design doc's 10-mutation
 * input collapse), the id decoded with the same `parseCompoundId`/
 * `NO_MATCH_USER_ID` convention `bookValidate` established — see that file's
 * resolver doc comment for the full malformed-id / wrong-type-id reasoning,
 * which applies here unchanged.
 */
builder.mutationField('bookResolvePendingFix', (t) =>
  t.field({
    type: result,
    nullable: true,
    description:
      'Accepts (applies) or dismisses (discards) a book’s pending metadata-fix ' +
      'proposals. Resolves to null when the book does not exist for the ' +
      'resolved owner.',
    args: { input: t.arg({ type: input, required: true }) },
    authScopes: (_parent, args) => {
      const parsed = parseCompoundId(args.input.id.id);
      return { ownerOf: parsed === null ? NO_MATCH_USER_ID : parsed[0] };
    },
    resolve: async (_parent, args, context) => {
      const parsed = parseCompoundId(args.input.id.id);
      if (parsed === null) return null; // admin passed scope on a malformed id: same "no such row" convention
      const [userId, bookId] = parsed;
      const owner = await context.loadOwner(userId);
      if (owner === null) return null;

      const targetBook = await context.stores.book.getBookById(owner, bookId);
      if (targetBook === null) return null;

      if (args.input.action === 'dismiss') {
        await context.stores.book.deletePendingFix(owner, targetBook.id);
        return {
          __typename: 'BookResolvePendingFixPayload' as const,
          owner,
          bookId: targetBook.id,
        };
      }

      const row = await context.prisma.pendingFix.findUnique({
        where: { userId_bookId: { userId: owner.userId, bookId: targetBook.id } },
      });
      if (row === null) {
        return {
          __typename: 'BookResolvePendingFixPayload' as const,
          owner,
          bookId: targetBook.id,
        };
      }

      const state = parsePendingFixState(row.state);
      // Review I-2: only proposals REST's client would itself apply
      // (`p.to !== null`, `use-upload-queue.ts:421`) — an advisory-only
      // proposal folds to an empty `EpubChanges` and must not trigger a
      // pointless rewrite.
      const actionable = state.proposals.filter((fix) => fix.to !== null);

      if (actionable.length === 0) {
        return {
          __typename: 'BookResolvePendingFixPayload' as const,
          owner,
          bookId: targetBook.id,
        };
      }

      if (targetBook.valid !== true) {
        return bookNotValidatedError(owner, targetBook.id);
      }

      const changes = foldProposalsIntoChanges(actionable, targetBook.subjects);

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

      // Review I-1: mirrors what REST's client's `applyAllProposals` +
      // sync effect actually persist — the row survives with the applied
      // (actionable) fixes removed from `proposals` (advisory-only ones left
      // behind), appended to `appliedFixes`, and a fresh `undo` snapshot
      // armed from the PRE-accept state. `undo` being non-null means
      // `upsertPendingFix`'s own "resolved ⟹ delete" rule never fires here.
      await context.stores.book.upsertPendingFix(owner, outcome.ok.id, row.fileName, row.fileSize, {
        autoFixes: state.autoFixes,
        appliedFixes: [...state.appliedFixes, ...actionable],
        proposals: state.proposals.filter((fix) => fix.to === null),
        undo: {
          kind: 'apply',
          proposals: state.proposals,
          appliedFixes: state.appliedFixes,
          // Captured from the PRE-edit book, which this resolver already holds — no
          // extra read. These are the same five editable fields REST's client
          // snapshotted for itself before patching (`fetchBookSnapshot`,
          // `use-upload-queue.ts`); `UNDO` (this mutation's own action) is the only
          // reader, so it is persisted but deliberately NOT exposed on the GraphQL
          // `UndoSnapshot` type — see the step-9 spec §3.1.
          originalMetadata: {
            title: targetBook.title,
            titleSort: targetBook.titleSort,
            author: targetBook.author,
            authorSort: targetBook.authorSort,
            subjects: targetBook.subjects,
          },
        },
      });

      return {
        __typename: 'BookResolvePendingFixPayload' as const,
        owner,
        bookId: outcome.ok.id,
      };
    },
  })
);
