import {
  applyEpubChanges,
  type ApplyEpubChangesDeps,
} from '../../../../services/apply-epub-changes';
import { getBookById } from '../../../../services/book-catalog';
import { BookHashCollisionError } from '../../../../services/book-errors';
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
import { model as metadataFixKey } from '../../metadata-fix-key';
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
    // Omitted means every proposal — the shape this mutation shipped with.
    // Only ACCEPT and DISMISS read this; UNDO and CLEAR act on the whole row
    // by definition. See `selectProposals` below for how it is applied.
    fixes: t.field({
      type: [metadataFixKey],
      required: false,
      description:
        "Restricts ACCEPT/DISMISS to this named subset of the row's proposals, addressed " +
        'by their field+kind+from key. Omitting it (the default) means every proposal — ' +
        "the mutation's original all-or-nothing behaviour. Ignored by UNDO and CLEAR, " +
        'which always act on the whole row. A key that matches no current proposal is ' +
        'silently ignored rather than erroring, since a no-longer-present fix is a benign ' +
        'race (someone else resolved it first).',
    }),
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

/** The client's `fixKey` (`field:kind:from`), server-side. */
const keyOf = (fix: { field: string; kind: string; from: string }): string =>
  `${fix.field}:${fix.kind}:${fix.from}`;

/**
 * The proposals an action addresses. `null`/absent `fixes` means all of them,
 * preserving the mutation's original all-or-nothing contract. Keys that match
 * nothing are simply absent from the result — a no-longer-present fix is a
 * benign race (someone else resolved it first), not an error worth failing a
 * whole mutation over.
 */
const selectProposals = (
  proposals: readonly MetadataFix[],
  fixes: readonly { field: string; kind: string; from: string }[] | null | undefined
): MetadataFix[] => {
  if (fixes === null || fixes === undefined) return [...proposals];
  const wanted = new Set(fixes.map(keyOf));
  return proposals.filter((p) => wanted.has(keyOf(p)));
};

/**
 * Covers the client's upload-queue operations as ONE mutation with an
 * `action` discriminator, per the spec's mutation list, which names only
 * `bookResolvePendingFix` (no separate mutation per action). Of REST's two
 * pending-fix write routes (`PUT`/`DELETE /api/books/:id/pending-fixes`,
 * `routes/ui.ts:776-811`), only `CLEAR` is a literal mirror; `DISMISS`,
 * `ACCEPT`, and `UNDO` are all new server-side behaviour — see each action's
 * own paragraph below.
 *
 * **CLEAR is a direct REST mirror.** `DELETE /api/books/:id/pending-fixes`
 * is `bookStore.deletePendingFix(owner, id)` unconditionally — no book- or
 * row-existence check at all (traced: `routes/ui.ts:802-811`) — so this
 * branch mirrors that literally: it never touches the EPUB, never checks
 * whether a `PendingFix` row exists, and always succeeds once the book
 * itself resolves. See the `'clear'` branch below for the implementation.
 *
 * **DISMISS is NOT a REST route — it is client-side-only there**
 * (`dismissAllProposals`, traced in the task report), server-side now. It
 * removes proposals without applying them: `proposals` is cleared to `[]`
 * and `undo: { kind: 'dismiss', proposals: <the pre-dismiss proposals>,
 * appliedFixes: <unchanged> }` is armed so the client's existing undo
 * affordance can recover them, mirroring how ACCEPT arms its own `kind:
 * 'apply'` undo on success (see ACCEPT's paragraphs below for the
 * `upsertPendingFix`/`undo` shape both actions share). It never touches the
 * EPUB, so unlike ACCEPT it is not gated on `targetBook.valid`. A row whose
 * `proposals` is already empty is left completely untouched rather than
 * arming a pointless empty-proposals undo (see the `'dismiss'` branch
 * below).
 *
 * **ACCEPT is NOT a literal REST mirror — flagged, per the task's escalation
 * instruction — but IS designed to be behaviourally EQUIVALENT to what REST's
 * client actually persists**, traced end to end after a
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
 * (The trace above was taken against
 * `app/client/src/provider/book/hook/use-upload-queue.ts` — the client's
 * REST upload engine, which is DELETED. It is a historical citation: that
 * file was correct when this comment was written and existed up to
 * `7bfd9ec7`, which merged the queue onto GraphQL and removed it. The live
 * queue is `app/client/src/provider/upload/hook/use-upload-queue.ts`, and
 * it no longer performs the two-step PATCH-then-PUT flow described above —
 * it calls THIS mutation. Read the old path at `7bfd9ec7^` if you need to
 * re-check the equivalence claim; do not look for that behaviour in the
 * live file.)
 *
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
 * but only once there is at least one actionable proposal to apply. Neither
 * DISMISS nor CLEAR ever calls `applyEpubChanges`, so neither is gated.
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
 * **UNDO is NOT a REST route either — REST's client did undo itself**: re-PATCH
 * the original metadata, `DELETE` the book's lineage, restore the proposal
 * list locally (`use-upload-queue.ts`'s undo affordance, traced in the task
 * report). With the server owning fix state, none of those three halves can
 * be done client-side any more — there is no state-write mutation left for
 * the client to call and it no longer holds `originalMetadata` at all — so
 * `UNDO` reproduces all three server-side, keyed off whichever `undo`
 * snapshot (`Task 2`'s hoisted `row`/`state` read) is currently armed:
 *
 * - **No snapshot armed** (`state.undo === null`, e.g. a double-undo or a
 *   post-CLEAR row): a strict no-op, same convention as ACCEPT's/DISMISS's
 *   own "nothing to do" branches — REST's client returned `true` here without
 *   even issuing a request, so this mirrors that rather than fabricating an
 *   error for it.
 * - **A `dismiss` snapshot**: pure state restoration — the EPUB is never
 *   touched, so unlike the `apply` case below there is no `targetBook.valid`
 *   gate and no `applyEpubChanges` call.
 * - **An `apply` snapshot**: additionally reverts metadata through the exact
 *   same `applyEpubChanges` path ACCEPT uses (with the snapshot's persisted
 *   `originalMetadata` — the five editable fields ACCEPT captured from the
 *   PRE-edit book, see ACCEPT's own paragraph above — folded in as the
 *   target `EpubChanges`), so it inherits ACCEPT's identical `targetBook.
 *   valid` gate and identical typed failures (`BookHashCollisionError` /
 *   `EpubValidationError`). A typed failure returns BEFORE
 *   `upsertPendingFix` runs, leaving the snapshot armed exactly like every
 *   other typed-failure branch in this schema leaves its row untouched — a
 *   failed revert must not strand the book in the applied state with no way
 *   back. A successful revert best-effort clears the book's organic edit
 *   lineage (`BookStore.clearEditLineage`) the same way REST's client's
 *   `DELETE` did, but — mirroring that client's own fire-and-forget
 *   tolerance — the revert stands even if that cleanup throws, since the
 *   metadata is already back by the time it runs.
 *
 * Either way, on success the row is rewritten with the snapshot's `proposals`/
 * `appliedFixes` restored and `undo: null` — the mirror image of what DISMISS/
 * ACCEPT arm on their own way in. Because `undo` is `null` here,
 * `upsertPendingFix`'s "resolved ⟹ delete" rule (`book-store.ts:661-665`)
 * DOES fire when the restored `proposals` is also empty (a `dismiss` snapshot
 * that itself held nothing) — correct: a row with nothing pending and nothing
 * armed has no reason to exist.
 *
 * Input is the `Book` global ID plus `action` (design doc's 10-mutation
 * input collapse), the id decoded with the same `parseCompoundId`/
 * `NO_MATCH_USER_ID` convention `bookValidate` established — see that file's
 * resolver doc comment for the full malformed-id / wrong-type-id reasoning,
 * which applies here unchanged.
 *
 * **`fixes` narrows ACCEPT/DISMISS to a named subset (task-4).** `FixReview`
 * renders Accept/Reject on each individual fix, not just the row as a whole,
 * so an all-or-nothing mutation would force the client to keep applying
 * fixes itself — exactly what this migration step removes. `fixes` is an
 * optional list of `MetadataFixKeyInput` (`field`+`kind`+`from` — see that
 * type's own doc comment for why the triple, not an id or an index, is how a
 * `MetadataFix` is addressed); omitting it means "every proposal", which is
 * this mutation's original, unchanged, all-or-nothing behaviour — every
 * pre-existing all-or-nothing test in this file is the regression guard for
 * that equivalence. `selectProposals` (above) is the one place both ACCEPT
 * and DISMISS apply it. `UNDO` and `CLEAR` ignore it: both act on the whole
 * row by definition, `UNDO` because a snapshot restores everything it
 * captured and `CLEAR` because it deletes the row outright. A key that
 * matches no current proposal is silently ignored, not an error: the fix it
 * named is simply no longer there (someone else resolved it first), which is
 * a benign race, not a caller mistake worth failing the whole mutation over.
 */
builder.mutationField('bookResolvePendingFix', (t) =>
  t.field({
    type: result,
    nullable: true,
    description:
      'Resolves a book’s pending metadata-fix proposals: ACCEPT applies them ' +
      '(arming an undo), DISMISS clears them (arming an undo), UNDO reverts ' +
      'whichever of those two an armed undo snapshot recorded, or CLEAR deletes ' +
      'the pending-fix row outright. ACCEPT and DISMISS accept an optional `fixes` ' +
      'list to act on a named subset of the row’s proposals instead of all of them; ' +
      'omitting `fixes` means every proposal, which is this mutation’s original ' +
      'behaviour. UNDO and CLEAR ignore `fixes` — both always act on the whole row. ' +
      'Resolves to null when the book does not exist for the resolved owner.',
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

      const targetBook = await getBookById(context.prisma, context.config.booksDir, owner, bookId);
      if (targetBook === null) return null;

      if (args.input.action === 'clear') {
        // The literal successor to REST's unconditional
        // `DELETE /api/books/:id/pending-fixes` — no row-existence check, no
        // EPUB access, always succeeds once the book itself resolves.
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

      // Hoisted so UNDO's `apply`-snapshot revert and ACCEPT can share one
      // instance — both reach the identical `applyEpubChanges` call.
      const deps: ApplyEpubChangesDeps = {
        bookStore: context.stores.book,
        prisma: context.prisma,
        validationThreshold: context.config.validationThreshold,
      };

      if (args.input.action === 'dismiss') {
        // Client-side-only in REST (`dismissAllProposals`); server-side now.
        // Never touches the EPUB, so no `valid` gate.
        const dismissed = selectProposals(state.proposals, args.input.fixes);
        if (dismissed.length === 0) {
          return {
            __typename: 'BookResolvePendingFixPayload' as const,
            owner,
            bookId: targetBook.id,
          };
        }
        const dismissedKeys = new Set(dismissed.map(keyOf));
        await context.stores.book.upsertPendingFix(
          owner,
          targetBook.id,
          row.fileName,
          row.fileSize,
          {
            autoFixes: state.autoFixes,
            appliedFixes: state.appliedFixes,
            proposals: state.proposals.filter((fix) => !dismissedKeys.has(keyOf(fix))),
            // Restores the FULL pre-dismiss list, not just the dismissed subset —
            // undo reverts to what was there before, not what was removed.
            undo: { kind: 'dismiss', proposals: state.proposals, appliedFixes: state.appliedFixes },
          }
        );
        return {
          __typename: 'BookResolvePendingFixPayload' as const,
          owner,
          bookId: targetBook.id,
        };
      }

      if (args.input.action === 'undo') {
        const snapshot = state.undo;
        if (snapshot === null) {
          // Nothing armed — a double-undo or an expired row. REST's client
          // returned `true` here without a request; mirror that as a no-op
          // rather than fabricating an error.
          return {
            __typename: 'BookResolvePendingFixPayload' as const,
            owner,
            bookId: targetBook.id,
          };
        }

        let revertedId = targetBook.id;

        if (snapshot.kind === 'apply' && snapshot.originalMetadata !== undefined) {
          if (targetBook.valid !== true) {
            return bookNotValidatedError(owner, targetBook.id);
          }
          const outcome = await toResult<Book, BookHashCollisionError | EpubValidationError>(
            () =>
              applyEpubChanges(deps, owner, targetBook, snapshot.originalMetadata as EpubChanges),
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
          revertedId = outcome.ok.id;

          // Best-effort, exactly like REST's client: the revert stands even if
          // lineage cleanup fails, because the metadata is already back.
          try {
            await context.stores.book.clearEditLineage(owner, revertedId);
          } catch {
            // intentionally swallowed — see above
          }
        }

        await context.stores.book.upsertPendingFix(owner, revertedId, row.fileName, row.fileSize, {
          autoFixes: state.autoFixes,
          appliedFixes: snapshot.appliedFixes,
          proposals: snapshot.proposals,
          undo: null,
        });

        return {
          __typename: 'BookResolvePendingFixPayload' as const,
          owner,
          bookId: revertedId,
        };
      }

      // Review I-2: only proposals REST's client would itself apply
      // (`p.to !== null`, `use-upload-queue.ts:421`) — an advisory-only
      // proposal folds to an empty `EpubChanges` and must not trigger a
      // pointless rewrite. `selected` narrows to the `fixes` subset first
      // (all proposals when `fixes` is omitted); a key matching nothing
      // simply yields an empty `selected`, which falls into the same
      // strict no-op branch below as "nothing actionable".
      const selected = selectProposals(state.proposals, args.input.fixes);
      const actionable = selected.filter((fix) => fix.to !== null);

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
      // (actionable) fixes removed from `proposals` (advisory-only ones, and
      // any fixes outside the `fixes` subset, left behind), appended to
      // `appliedFixes`, and a fresh `undo` snapshot armed from the PRE-accept
      // state. `undo` being non-null means `upsertPendingFix`'s own
      // "resolved ⟹ delete" rule never fires here.
      //
      // The surviving set is "everything not applied"
      // (`!appliedKeys.has(keyOf(fix))`), not "everything advisory" — with a
      // subset, an unselected actionable proposal must also survive. This is
      // behaviour-preserving when `fixes` is omitted: with every proposal
      // selected, `actionable` is exactly the `to !== null` ones, so the only
      // survivors are the `to === null` (advisory) ones — identical to the
      // old `state.proposals.filter(fix => fix.to === null)`.
      const appliedKeys = new Set(actionable.map(keyOf));
      await context.stores.book.upsertPendingFix(owner, outcome.ok.id, row.fileName, row.fileSize, {
        autoFixes: state.autoFixes,
        appliedFixes: [...state.appliedFixes, ...actionable],
        proposals: state.proposals.filter((fix) => !appliedKeys.has(keyOf(fix))),
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
