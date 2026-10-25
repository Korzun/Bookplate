import type { RatingFieldSummary } from '../../../services/rating-profile';
import { builder } from '../builder';
import { model as ratingField } from '../rating-field/model';

export const model = builder.objectRef<RatingFieldSummary>('RatingFieldSummary').implement({
  fields: (t) => ({
    field: t.field({
      type: ratingField,
      resolve: (s) =>
        s.field.toUpperCase() as 'OVERALL' | 'STORY' | 'CHARACTERS' | 'WRITING' | 'IDEAS',
    }),
    count: t.exposeInt('count', { description: 'Books with this field rated.' }),
    mean: t.exposeFloat('mean', {
      nullable: true,
      description: 'Mean over rated books, null when count is 0.',
    }),
    distribution: t.exposeIntList('distribution', {
      description: 'Five counts, for values 1 through 5 in order.',
    }),
  }),
});
