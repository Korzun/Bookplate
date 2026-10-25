import { favouriteBooks, ratedCount, ratingSummaries } from '../../../services/rating-profile';
import type { Owner } from '../../../types';
import { model as book } from '../book/model';
import { builder } from '../builder';
import { CONNECTION_LIMITS } from '../pagination';
import { model as ratingFieldSummary } from '../rating-field-summary/model';

const clamp = (n: number, min: number, max: number): number => Math.min(Math.max(n, min), max);

export const model = builder.objectRef<Owner>('LibraryRatingProfile').implement({
  fields: (t) => ({
    ratedCount: t.int({
      description: 'Books with an overall rating.',
      resolve: (owner, _args, context) => ratedCount(context.prisma, owner.userId),
    }),
    fields: t.field({
      type: [ratingFieldSummary],
      description: 'One entry per RatingField, in enum order.',
      resolve: (owner, _args, context) => ratingSummaries(context.prisma, owner.userId),
    }),
    favourites: t.prismaField({
      type: [book],
      description:
        'Books whose overall rating is at least minOverall, most recently rated first. Default is the Love shelf.',
      args: {
        minOverall: t.arg.int({ defaultValue: 5, required: false }),
        first: t.arg.int({ defaultValue: 25, required: false }),
      },
      resolve: (query, owner, args, context) =>
        favouriteBooks(
          context.prisma,
          owner.userId,
          clamp(args.minOverall ?? 5, 1, 5),
          clamp(args.first ?? 25, 1, CONNECTION_LIMITS.ratingFavourites.maxSize),
          query
        ),
    }),
  }),
});
