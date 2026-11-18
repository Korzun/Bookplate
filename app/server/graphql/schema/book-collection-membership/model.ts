import { builder } from '../builder';

/** A book's membership in a collection, with its optional position. */
export const model = builder.prismaObject('BookCollection', {
  name: 'BookCollectionMembership',
  fields: (t) => ({
    book: t.relation('book'),
    collection: t.relation('collection'),
    position: t.exposeFloat('position', { nullable: true }),
  }),
});
