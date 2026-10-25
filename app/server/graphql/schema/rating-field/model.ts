import { builder } from '../builder';

/** Upper-cased `RATING_FIELDS` (services/rating.ts), in the same order. */
export const model = builder.enumType('RatingField', {
  values: ['OVERALL', 'STORY', 'CHARACTERS', 'WRITING', 'IDEAS'] as const,
});
