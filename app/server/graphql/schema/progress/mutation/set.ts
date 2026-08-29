import { z } from 'zod';

import { getBookById } from '../../../../services/book-catalog';
import { saveProgress } from '../../../../services/progress';
import type { Owner } from '../../../../types';
import { builder } from '../../builder';
import {
  invalidInputError,
  model as invalidInputErrorModel,
} from '../../invalid-input-error/model';
import { model as library } from '../../library/model';
import { model as user } from '../../user/model';
import { model as progressModel } from '../model';

/**
 * `userId` (a `User` global ID, per the spec's rule for every user-associated
 * mutation — `libraryScan`'s identical field, `library/mutation/scan.ts`),
 * `document`, plus the exact body `PUT /api/my/progress/:document` accepts
 * (`routes/ui.ts:338-381`). NOT a raw `progress` CFI string: that route does
 * not take one — the client sends `currentChapter` (a 1-based chapter
 * number) and the server itself synthesises a CFI from the book's
 * `chapterSpineMap`, mirrored verbatim in this resolver. This is worth
 * flagging: the task brief describes REST as "kosync-shaped" (matching
 * `PUT /sync/syncs/progress` in `routes/kosync.ts`, which DOES take a raw
 * `progress` CFI), but that is a different route entirely — `/api/my/progress/
 * :document` is the one this mutation actually mirrors, and REST governs on
 * conflict.
 */
const input = builder.inputType('ProgressSetInput', {
  fields: (t) => ({
    userId: t.globalID({
      required: true,
      for: user,
      description:
        "Must be the viewer's own User id: unlike every other user-associated " +
        'mutation, there is no admin write path for progress.',
    }),
    document: t.string({ required: true }),
    currentChapter: t.int({ required: true }),
    percentage: t.float({ required: true }),
    device: t.string({ required: false }),
    deviceId: t.string({ required: false }),
  }),
});

/**
 * `document` and `currentChapter`/`percentage` bounds are REST's exact checks
 * (`routes/ui.ts:350-360`): `currentChapter` must be a positive integer,
 * `percentage` must be in `(0, 1]` — REST rejects `percentage <= 0` (not just
 * `< 0`) and `percentage > 1`. `document.min(1)` has no REST analogue (the
 * route's `:document` path segment cannot be empty) but matches every other
 * id-like field's rule in this schema (`bookId` elsewhere) — an empty string
 * is a client bug, not a valid lookup. `progressDelete` no longer has a
 * comparable field to cite here: its `document` component now rides inside
 * an opaque `Progress` id rather than arriving as a raw argument, so there is
 * nothing left there to zod-validate directly (see that file's own doc
 * comment on why its `InvalidInputError` member was dropped).
 *
 * No `.int()` on `currentChapter`: GraphQL's `Int!` coercion already rejects
 * a non-integer before the resolver runs (unlike REST, which parses an
 * untyped JSON body and needs its own `Number.isInteger` check), so a zod
 * integer check here would be unreachable dead code, not belt-and-braces.
 *
 * `device`/`deviceId` are deliberately NOT in this schema: REST never rejects
 * them, it only defaults them (see the resolver), so there is nothing to
 * validate.
 */
const inputSchema = z.object({
  document: z.string().min(1, 'document must not be empty'),
  currentChapter: z.number().min(1, 'currentChapter must be at least 1'),
  percentage: z
    .number()
    .gt(0, 'percentage must be greater than 0')
    .lte(1, 'percentage must be at most 1'),
});

type ProgressSetPayloadShape = {
  readonly __typename: 'ProgressSetPayload';
  readonly owner: Owner;
  readonly document: string;
};

/**
 * Pairs the input's `userId` with the caller's own username — sound only
 * because `authScopes` (below) already proved `userId === context.viewer
 * .userId`, so this is never asked to pair a foreign `userId` with the
 * viewer's username. Exported and unit-tested directly (task-5 review,
 * M-4): no GraphQL field this payload exposes currently discriminates a
 * wrong username from a correct one — `Library`'s fields (`library/
 * model.ts`) all key off `owner.userId` alone (`user.findUniqueOrThrow`,
 * `getSubjects`, `getAuthors`, `book` all query by `userId`; `username` is
 * carried but never itself queried on), so an integration test asserting
 * `library.user.username` cannot catch a hardcoded/swapped username here —
 * it was verified experimentally that hardcoding `username: 'wrong-user'`
 * left every existing test green. This function is the one place the pair
 * is assembled, so it is pinned at that level instead.
 */
export const buildOwner = (userId: string, viewer: { readonly username: string }): Owner => ({
  userId,
  username: viewer.username,
});

/**
 * `progress` is a fresh read of the row this resolver just wrote, by its
 * compound key — NOT the DTO `saveProgress` (`services/progress.ts`)
 * returns (`device_id`, no `userId`), which cannot serve as
 * `progress/model.ts`'s `currentChapter` field resolver: that resolver reads
 * `progress.userId` off its parent, and the DTO doesn't have one. Same "two
 * queries, deliberately" split `Library.progress` already uses, for the
 * identical reason (see that field's doc comment in `library/model.ts`) —
 * `saveProgress` decides what was written, a second read supplies the real
 * row shape every `Progress` field resolver expects. `t.prismaField`
 * (rather than a plain `t.field`) lets a
 * client select only the sub-fields it needs off that second read.
 */
const payload = builder.objectRef<ProgressSetPayloadShape>('ProgressSetPayload').implement({
  fields: (t) => ({
    progress: t.prismaField({
      type: progressModel,
      resolve: (query, parent, _args, context) =>
        context.prisma.progress.findUniqueOrThrow({
          ...query,
          where: { userId_document: { userId: parent.owner.userId, document: parent.document } },
        }),
    }),
    library: t.field({ type: library, resolve: (result) => result.owner }),
    // `owner.userId` is exactly `context.viewer.userId` here (this mutation
    // has no admin write path — see the field's own doc comment below), so
    // this always resolves the CALLER's own `User` row. Same resolver shape
    // as `Library.user` (`library/model.ts`): a fresh `findUniqueOrThrow` by
    // id, not a cached/DTO value, so `User.progressCount`
    // (`t.relationCount('progresses')`) reads the row's CURRENT count —
    // i.e. the one this mutation's own write just changed. Lets the client
    // normalize the count straight onto the already-cached `User:<id>`
    // entity (`graphql/progress.ts`'s `ProgressSetDocument`, I-2) instead of
    // hand-rolling a client-side increment.
    user: t.field({
      type: user,
      resolve: (result, _args, context) =>
        context.prisma.user.findUniqueOrThrow({ where: { id: result.owner.userId } }),
    }),
  }),
});

/**
 * No `resolveType`: every member value carries its own `__typename` — see
 * `progress/mutation/delete.ts`'s identical note.
 */
const result = builder.unionType('ProgressSetResult', {
  types: [payload, invalidInputErrorModel],
});

/**
 * Mirrored `PUT /api/my/progress/:document` (`routes/ui.ts`, that route
 * since removed) — a viewer-only route with NO admin path at all:
 * `req.user!.isAdmin` got a flat 403, and unlike `DELETE /api/my/progress/:document`
 * (which `progressDelete` also mirrored), there was no second, admin-capable
 * REST route to widen from — `routes/users.ts` had `GET .../progress` and
 * `DELETE .../progress/:document` for an admin acting on a named user, but
 * no `PUT`/`POST` equivalent. That was checked directly against that file's
 * source before Phase 0 removed that router: no branch wrote another
 * user's progress, admin or otherwise.
 *
 * So this mutation deliberately does NOT use the `ownerOf` scope
 * (`isOwnerOrAdmin`) every other user-associated mutation in this schema
 * uses (`progressDelete`, `bookUpdateMetadata`, …) — every one of those has a
 * REST-verified admin path (a second admin-only route, or `resolveOwner`'s
 * `?user=` query param) to justify it; this one has neither. Granting admin
 * access here would be a genuine over-grant beyond what REST allows, not a
 * mirror of it. `userId` is still taken as an input field, for the same
 * shape-consistency reason every user-associated mutation takes one (spec,
 * "Mutations" section) — but the scope check requires it to name the caller
 * exactly: `context.viewer.userId === args.input.userId.id`, which the
 * config-admin (whose `viewer.userId` is always `null`) can never satisfy,
 * and no other user's id can satisfy either. This returns a plain `boolean`
 * rather than an `AuthScopeMap` — Pothos's `FieldAuthScopes` callback type
 * permits either (`@pothos/plugin-scope-auth/dts/types.d.ts`).
 *
 * Since the scope already pins `owner` to exactly `context.viewer`, there is
 * no `loadOwner`/null-owner branch here (contrast `progressDelete` and
 * `bookUpdateMetadata`, which admit an admin-named `userId` that might not
 * resolve to a real row) — `owner` is built directly from the input/context,
 * and the field is non-nullable.
 *
 * `saveProgress` (`services/progress.ts:27`) is an upsert — it
 * creates the row if absent, updates it otherwise — so this mirrors REST's
 * upsert semantics exactly: there is no "document must already exist"
 * precondition, and `getBookById` (`services/book-catalog.ts`) below is consulted only to
 * synthesise a chapter-accurate CFI, never as an existence gate (REST
 * proceeds with an empty CFI when the book is unknown or the chapter is out
 * of range — see `routes/ui.ts:362-371` — and so does this resolver). Not
 * wrapped in `toResult`: `saveProgress` throws none of the seven known store
 * errors, and neither does `getBookById` — both are plain Prisma reads/an
 * upsert with no domain-error path, so the `err` branch `toResult` would add
 * could only be discharged by throwing, the very thing it exists to avoid.
 */
builder.mutationField('progressSet', (t) =>
  t.field({
    type: result,
    description: 'Creates or updates the viewer’s stored reading position for one document.',
    args: { input: t.arg({ type: input, required: true }) },
    authScopes: (_parent, args, context) =>
      context.viewer !== null && context.viewer.userId === args.input.userId.id,
    resolve: async (_parent, args, context) => {
      const parsed = inputSchema.safeParse({
        document: args.input.document,
        currentChapter: args.input.currentChapter,
        percentage: args.input.percentage,
      });
      if (!parsed.success) return invalidInputError(parsed.error);

      // authScopes already required args.input.userId.id === context.viewer.userId,
      // so the owner is exactly the caller — see buildOwner's doc comment for
      // why the pairing is unit-tested separately from this resolver.
      const owner: Owner = buildOwner(args.input.userId.id, context.viewer!);

      // Synthesise a minimal EPUB CFI so currentChapter persists through
      // Progress.currentChapter, exactly like REST's GET /api/my/progress —
      // see routes/ui.ts:361-371.
      const book = await getBookById(
        context.prisma,
        context.config.booksDir,
        owner,
        parsed.data.document
      );
      let progressCfi = '';
      if (
        book &&
        book.chapterSpineMap.length > 0 &&
        parsed.data.currentChapter <= book.chapterSpineMap.length
      ) {
        const spineIndex = book.chapterSpineMap[parsed.data.currentChapter - 1];
        progressCfi = `EPUB_CFI(/6/${spineIndex * 2 + 2}!/4/2:0)`;
      }

      // REST's exact fallback rules (routes/ui.ts:376-377): an empty or
      // missing device becomes 'Web'. deviceId has no such rule — REST keeps
      // any string value, including '', and only substitutes '' when the
      // field isn't a string at all; `?? ''` below covers omitted/null the
      // same way, and an explicit '' is indistinguishable from omission
      // either way (both produce ''), so there is nothing to discriminate.
      const device =
        args.input.device != null && args.input.device !== '' ? args.input.device : 'Web';
      const deviceId = args.input.deviceId ?? '';

      await saveProgress(context.prisma, owner.userId, {
        document: parsed.data.document,
        progress: progressCfi,
        percentage: parsed.data.percentage,
        device,
        device_id: deviceId,
      });

      return {
        __typename: 'ProgressSetPayload' as const,
        owner,
        document: parsed.data.document,
      };
    },
  })
);
