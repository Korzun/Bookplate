import { deleteBookRequest } from '../../../../services/book-request';
import { builder } from '../../builder';
import { decodeCompoundGlobalId, isOwnerOrAdmin } from '../../node-scope';

type BookRequestDeletePayloadShape = {
  readonly __typename: 'BookRequestDeletePayload';
  readonly deletedId: string;
};

/**
 * `deletedId` is the global id the caller passed, echoed back so a normalizing
 * client cache can evict the exact entry it already holds — the same contract
 * `BookDeletePayload.deletedId` carries.
 */
const payload = builder
  .objectRef<BookRequestDeletePayloadShape>('BookRequestDeletePayload')
  .implement({
    fields: (t) => ({
      deletedId: t.exposeID('deletedId'),
    }),
  });

/**
 * Withdraws or clears a request. THE ONE MUTATION HERE THAT IS OWNER-OR-ADMIN
 * rather than admin-only: it serves both "the reader withdraws a pending
 * request" and "clear a resolved one off my list", and the reader is the owner
 * in the first case.
 *
 * The scope is computed from the ID's OWN `userId`, not from `context.viewer`,
 * because the row's owner rides inside the global id — the same reasoning
 * `ownerScopedFindUnique` rests on. A caller who is neither gets `null`, the
 * same answer a request that does not exist gets, so nothing leaks about
 * whether another reader has that id.
 *
 * No union: there is no failure a client renders differently. Null is the whole
 * of "it is not there, or it is not yours".
 */
builder.mutationField('bookRequestDelete', (t) =>
  t.field({
    type: payload,
    nullable: true,
    description: 'Withdraws a pending request, or clears a resolved one.',
    // No field-level `authScopes`: `Mutation` is already `{ authenticated:
    // true }` at the type level and Pothos ANDs the two. The owner check
    // CANNOT be an `ownerOf` scope here, because the owner is not an argument —
    // it rides inside the compound global id and has to be decoded out first.
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const request = decodeCompoundGlobalId(String(args.id), 'BookRequest');
      if (request === null) return null;
      const [userId, requestId] = request;

      if (!isOwnerOrAdmin(context.viewer, userId)) return null;

      const deleted = await deleteBookRequest(context.prisma, { userId, id: requestId });
      return deleted
        ? { __typename: 'BookRequestDeletePayload' as const, deletedId: String(args.id) }
        : null;
    },
  })
);
