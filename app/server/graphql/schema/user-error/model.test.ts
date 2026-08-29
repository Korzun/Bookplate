import {
  isNonNullType,
  isObjectType,
  Kind,
  parse,
  type GraphQLObjectType,
  type GraphQLResolveInfo,
} from 'graphql';

import {
  BookHashCollisionError,
  DocumentAlreadyLinkedError,
  DocumentIsBookError,
  SelfLinkError,
} from '../../../services/book-errors';
import { DeviceSlugConflictError } from '../../../services/device';
import { EpubValidationError } from '../../../services/epub-validator';
import { createChapterSpineMapLoader } from '../../chapter-spine-map-loader';
import type { Context } from '../../context';
import { createOwnerLoader } from '../../owner';
import { createPendingFixLoader } from '../../pending-fix-loader';
import { createProgressLoader } from '../../progress-loader';
import { createSeriesProgressLoader } from '../../series-progress-loader';
import { createHarness, type Harness } from '../../test-util';
import { bookHashCollisionError } from '../book-hash-collision-error';
import { deviceSlugConflictError } from '../device-slug-conflict-error';
import { documentAlreadyLinkedError } from '../document-already-linked-error';
import { documentIsBookError } from '../document-is-book-error';
import { epubValidationError } from '../epub-validation-error';
import { schema } from '../index';
import { selfLinkError } from '../self-link-error';

vi.mock('../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

const userErrorTypes = (): GraphQLObjectType[] =>
  Object.values(schema.getTypeMap()).filter(
    (type): type is GraphQLObjectType =>
      isObjectType(type) && type.getInterfaces().some((iface) => iface.name === 'UserError')
  );

/**
 * Structural guards over whatever implements `UserError` in the built schema,
 * following `node-scope.test.ts`'s generic shape: an error type added by a
 * later task joins these assertions without anyone remembering to extend a
 * list.
 */
describe('UserError', () => {
  it('is implemented by exactly the seven spec-enumerated types plus BookNotValidatedError, StagedUploadNotFoundError, EditLineageEntryError, LineageEntryNotFoundError, UsernameAlreadyExistsError, IncorrectPasswordError and ScanAlreadyRunningError', () => {
    // `BookAlreadyExistsError` was an eighth spec-enumerated type but is no
    // longer registered here: the GraphQL model (`schema/book-already-exists-
    // error/`) was removed by the lineage-gap plan's task 2 because it was
    // referenced by zero result unions — no mutation could ever return it, so
    // it only polluted Apollo's generated `possibleTypes`. The *store* error
    // class of the same name (`services/book-store.ts`, thrown by `addBook`)
    // is unaffected and still flows through `to-result.ts`'s
    // `KnownStoreError` union for the REST upload seam and scan pipeline.
    //
    // `BookNotValidatedError` is a ninth member, added by task 2 (review
    // Important-2) for a REST precondition (`book.valid !== true`) the spec's
    // original eight-type error model does not mention — scoped to
    // `BookUpdateMetadataResult` only, not a change to the spec's core seven
    // plus `InvalidInputError`.
    //
    // `StagedUploadNotFoundError` is a tenth member, added by task 3's
    // staged-upload adjudication (2026-08-01, spec's "Replace staging"
    // paragraph): `bookAnalyzeReplace`/`bookReplace`'s `stagedUploadId` names
    // a resource with no store class of its own (a `ReplaceStaging` registry
    // entry, not a Prisma row), so there is no store throw to map — the error
    // is produced directly by the resolver, same as `InvalidInputError`.
    //
    // `EditLineageEntryError` and `LineageEntryNotFoundError` are an eleventh
    // and twelfth member, added by task 4 for `bookUnlinkDocument`'s two REST-
    // mirrored preconditions (`DELETE /api/books/:id/link/:documentId`'s
    // `'edit_row'`/`'not_found'` results — plain string discriminators, not
    // store throws, so — like the two members above — the error is produced
    // directly by the resolver rather than mapped from a caught class. See
    // `edit-lineage-entry-error/model.ts` and
    // `lineage-entry-not-found-error/model.ts`.
    //
    // `UsernameAlreadyExistsError` and `IncorrectPasswordError` are a
    // thirteenth and fourteenth member, added by task 6 for `userRegister`'s
    // two 409 branches (reserved name / genuine duplicate — REST checks
    // both itself, `createUser` returns `false` rather than
    // throwing) and `userChangePassword`'s 401 (`validateUser`
    // also returns `false`, never throws) — same "resolver-produced, not
    // store-thrown" shape as the four members above. See
    // `username-already-exists-error/model.ts` and
    // `incorrect-password-error/model.ts`.
    //
    // `ScanAlreadyRunningError` is a fifteenth member, added by task 8 for
    // `libraryScan`'s REST-mirrored 409 (`POST /api/books/scan`'s
    // `scanJobStore.isRunning` precondition check, before `bookStore.scan` is
    // ever called) — same "resolver-produced, not store-thrown" shape as
    // `BookNotValidatedError` above. See
    // `scan-already-running-error/model.ts`.
    expect(
      userErrorTypes()
        .map((type) => type.name)
        .sort()
    ).toEqual([
      'BookHashCollisionError',
      'BookNotValidatedError',
      'DeviceSlugConflictError',
      'DocumentAlreadyLinkedError',
      'DocumentIsBookError',
      'EditLineageEntryError',
      'EpubValidationError',
      'IncorrectPasswordError',
      'InvalidInputError',
      'LineageEntryNotFoundError',
      'ScanAlreadyRunningError',
      'SelfLinkError',
      'StagedUploadNotFoundError',
      'UsernameAlreadyExistsError',
    ]);
  });

  it.each(userErrorTypes().map((type) => [type.name, type] as const))(
    '%s exposes a non-null message a client can always render',
    (_name, type) => {
      const message = type.getFields().message;
      expect(message).toBeDefined();
      expect(isNonNullType(message.type) && message.type.ofType.toString()).toBe('String');
    }
  );
});

/**
 * The factories are the only place a store exception becomes a GraphQL value,
 * so they are where "the message the client sees is the store's own" and "the
 * owner rides on the value" are decided.
 */
describe('user error factories', () => {
  it('carry the store error’s own message rather than restating it', () => {
    const collision = new BookHashCollisionError('c'.repeat(32));
    expect(bookHashCollisionError(collision, harness.aliceOwner).message).toBe(collision.message);

    const selfLink = new SelfLinkError();
    expect(selfLinkError(selfLink).message).toBe(selfLink.message);

    const linked = new DocumentAlreadyLinkedError('doc.epub');
    expect(documentAlreadyLinkedError(linked, harness.aliceOwner).message).toBe(linked.message);

    const isBook = new DocumentIsBookError('d'.repeat(32));
    expect(documentIsBookError(isBook, harness.aliceOwner).message).toBe(isBook.message);

    const slugConflict = new DeviceSlugConflictError();
    expect(deviceSlugConflictError(slugConflict, 'kobo').message).toBe(slugConflict.message);
  });

  it('tags every value with its own GraphQL type name, which is how unions resolve it', () => {
    expect(
      bookHashCollisionError(new BookHashCollisionError('x'), harness.aliceOwner).__typename
    ).toBe('BookHashCollisionError');
    expect(selfLinkError(new SelfLinkError()).__typename).toBe('SelfLinkError');
    expect(deviceSlugConflictError(new DeviceSlugConflictError(), 'kobo').__typename).toBe(
      'DeviceSlugConflictError'
    );
  });

  it('carries the slug the store error omits', () => {
    // DeviceSlugConflictError is raised from a P2002 and holds no data at all,
    // so the SDL's `slug` can only come from the caller — a regression here
    // would be a permanently empty field in the UI.
    expect(deviceSlugConflictError(new DeviceSlugConflictError(), 'kobo-clara').slug).toBe(
      'kobo-clara'
    );
  });

  it('passes epubcheck findings through unflattened', () => {
    const error = new EpubValidationError(
      [
        {
          id: 'RSC-005',
          severity: 'ERROR',
          message: 'bad',
          location: { path: 'OEBPS/a.xhtml', line: 3, column: 7 },
        },
      ],
      { FATAL: 0, ERROR: 1, WARNING: 0, INFO: 0, USAGE: 0 },
      'ERROR'
    );

    expect(epubValidationError(error).messages).toEqual(error.messages);
  });
});

/**
 * `BookHashCollisionError`, `DocumentIsBookError` and
 * `DocumentAlreadyLinkedError` each turn an id into a `Book`. No field in the
 * schema returns them yet — tasks 3 and 4 add the mutations whose result unions
 * do — so they cannot be reached through `harness.execute`, and their
 * resolvers are invoked directly against the built schema instead.
 *
 * Worth doing now rather than later: book ids are partial MD5s of file
 * content, so two users routinely hold the SAME id for the same EPUB. Every
 * case below seeds exactly that, which is the only arrangement in which
 * reading the owner off the error value and re-deriving it from the viewer
 * give different answers.
 */
describe('errors that resolve an id into a Book', () => {
  const contextFor = (viewer: Context['viewer']): Context => ({
    viewer,
    prisma: harness.prisma,
    stores: harness.stores,
    config: harness.config,
    loadOwner: createOwnerLoader(harness.prisma),
    loadProgress: createProgressLoader(harness.prisma),
    loadPendingFix: createPendingFixLoader(harness.prisma),
    loadChapterSpineMap: createChapterSpineMapLoader(harness.prisma),
    loadSeriesProgress: createSeriesProgressLoader(harness.prisma),
  });

  /**
   * Calls one field's resolver on the built schema with the minimum
   * `GraphQLResolveInfo` the prisma plugin needs to plan its query (a field
   * node with a subselection). The single cast is to `GraphQLResolveInfo`, not
   * `any`: graphql-js offers no public constructor for that object, and
   * building the real one would mean executing a query — which is precisely
   * what no path to these types allows yet.
   */
  const resolveField = async (
    typeName: string,
    fieldName: string,
    parent: unknown,
    context: Context
  ): Promise<{ id: string; title: string }> => {
    const type = schema.getType(typeName);
    if (!isObjectType(type)) throw new Error(`${typeName} is not an object type in the schema`);
    const field = type.getFields()[fieldName];
    if (field?.resolve === undefined) {
      throw new Error(`${typeName}.${fieldName} has no resolver`);
    }

    const document = parse(`{ ${fieldName} { __typename } }`);
    const operation = document.definitions[0];
    if (operation.kind !== Kind.OPERATION_DEFINITION) throw new Error('expected an operation');
    const fieldNode = operation.selectionSet.selections[0];
    if (fieldNode.kind !== Kind.FIELD) throw new Error('expected a field selection');

    const info = {
      fieldName,
      fieldNodes: [fieldNode],
      returnType: field.type,
      parentType: type,
      path: { prev: undefined, key: fieldName, typename: typeName },
      schema,
      fragments: {},
      rootValue: {},
      operation,
      variableValues: {},
    } as unknown as GraphQLResolveInfo;

    return (await field.resolve(parent, {}, context, info)) as { id: string; title: string };
  };

  const SHARED_ID = 'c'.repeat(32);

  const seedSharedBook = async (): Promise<void> => {
    await harness.prisma.book.create({
      data: {
        userId: harness.aliceOwner.userId,
        id: SHARED_ID,
        title: 'Alice’s copy',
        size: 1,
        mtime: 0,
        addedAt: 0,
      },
    });
    await harness.prisma.book.create({
      data: {
        userId: harness.bobOwner.userId,
        id: SHARED_ID,
        title: 'Bob’s copy',
        size: 1,
        mtime: 0,
        addedAt: 0,
      },
    });
  };

  it('BookHashCollisionError.collidingBook resolves the error’s owner’s copy, not the viewer’s', async () => {
    await seedSharedBook();

    // The owner on the value is bob's; the viewer is alice. Reading the owner
    // off the viewer instead would return "Alice’s copy" and look correct in
    // any single-tenant test.
    const value = bookHashCollisionError(new BookHashCollisionError(SHARED_ID), harness.bobOwner);
    const book = await resolveField(
      'BookHashCollisionError',
      'collidingBook',
      value,
      contextFor(harness.aliceViewer)
    );

    expect(book.title).toBe('Bob’s copy');
  });

  it('DocumentIsBookError.book resolves the error’s owner’s copy', async () => {
    await seedSharedBook();

    const value = documentIsBookError(new DocumentIsBookError(SHARED_ID), harness.bobOwner);
    const book = await resolveField(
      'DocumentIsBookError',
      'book',
      value,
      contextFor(harness.aliceViewer)
    );

    expect(book.title).toBe('Bob’s copy');
  });

  it('DocumentAlreadyLinkedError.book follows the owner’s id history to the live book', async () => {
    await seedSharedBook();
    // Only bob's library maps `old-doc.epub` onto the shared id. Alice's does
    // not map it at all, so an owner mix-up either resolves the wrong title or
    // fails to resolve.
    await harness.prisma.bookIdHistory.create({
      data: { userId: harness.bobOwner.userId, oldId: 'old-doc.epub', currentId: SHARED_ID },
    });

    const value = documentAlreadyLinkedError(
      new DocumentAlreadyLinkedError('old-doc.epub'),
      harness.bobOwner
    );
    const book = await resolveField(
      'DocumentAlreadyLinkedError',
      'book',
      value,
      contextFor(harness.aliceViewer)
    );

    expect(book.title).toBe('Bob’s copy');
    expect(book.id).toBe(SHARED_ID);
  });
});
