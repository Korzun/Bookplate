import type { Book } from '@prisma/client';

export const RATING_FIELDS = ['overall', 'story', 'characters', 'writing', 'ideas'] as const;

export type RatingFieldName = (typeof RATING_FIELDS)[number];

export type RatingValue = 1 | 2 | 3 | 4 | 5;

export const RATING_NAMES: Record<RatingValue, string> = {
  1: 'Bad',
  2: 'Okay',
  3: 'Nice',
  4: 'Great',
  5: 'Love',
};

export const RATING_COLUMNS: Record<
  RatingFieldName,
  'ratingOverall' | 'ratingStory' | 'ratingCharacters' | 'ratingWriting' | 'ratingIdeas'
> = {
  overall: 'ratingOverall',
  story: 'ratingStory',
  characters: 'ratingCharacters',
  writing: 'ratingWriting',
  ideas: 'ratingIdeas',
};

export function isRatingValue(n: unknown): n is RatingValue {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 5;
}

export function formatRating(value: number | null): string {
  if (value === null) return 'unrated';
  if (!isRatingValue(value)) return 'unrated';
  return `${RATING_NAMES[value]} (${value})`;
}

export type BookRatingShape = Record<RatingFieldName, number | null>;

export function ratingOf(
  row: Pick<
    Book,
    'ratingOverall' | 'ratingStory' | 'ratingCharacters' | 'ratingWriting' | 'ratingIdeas'
  >
): BookRatingShape {
  return {
    overall: row.ratingOverall,
    story: row.ratingStory,
    characters: row.ratingCharacters,
    writing: row.ratingWriting,
    ideas: row.ratingIdeas,
  };
}
