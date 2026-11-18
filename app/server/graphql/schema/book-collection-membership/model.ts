import { builder } from '../builder';

/** A book's membership in a collection, with its optional position. */
export const model = builder.prismaObject('BookCollection', {
  name: 'BookCollectionMembership',
  fields: (t) => ({
    book: t.relation('book'),
    // Joined by collectionId only; same-user is guaranteed by
    // `syncBookCollections`, which writes both sides under one userId.
    collection: t.relation('collection'),
    position: t.exposeFloat('position', { nullable: true }),
  }),
});
