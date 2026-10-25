import type { BookRatingShape } from '../../../services/rating';
import { builder } from '../builder';

export const model = builder.objectRef<BookRatingShape>('BookRating').implement({
  fields: (t) => ({
    overall: t.int({ nullable: true, resolve: (rating) => rating.overall }),
    story: t.int({ nullable: true, resolve: (rating) => rating.story }),
    characters: t.int({ nullable: true, resolve: (rating) => rating.characters }),
    writing: t.int({ nullable: true, resolve: (rating) => rating.writing }),
    ideas: t.int({ nullable: true, resolve: (rating) => rating.ideas }),
  }),
});
