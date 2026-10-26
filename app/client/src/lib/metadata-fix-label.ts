import type { MetadataFix } from './book-types';

const FIELD_LABEL: Record<string, string> = {
  title: 'Title',
  titleSort: 'Title sort',
  author: 'Author',
  authorSort: 'Author sort',
  subjects: 'Subjects',
  document: 'EPUB',
};

/** The user-facing name of the field a fix addresses, shared by the fix
 * review list and the single-field edit modal so both name a field the
 * same way. */
export const labelForFix = (fix: MetadataFix): string =>
  fix.kind === 'subjects-split' ? 'Subject' : (FIELD_LABEL[fix.field] ?? fix.field);
