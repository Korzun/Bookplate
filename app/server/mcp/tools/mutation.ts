/**
 * Every write tool runs a mutation whose result is a union of one payload
 * and some `UserError` members. This turns that union into either the
 * payload or a `ToolError` whose text names the error type and says what it
 * carried, so an assistant can tell "the EPUB failed validation" from "that
 * field was malformed" without parsing GraphQL.
 */
import { NOT_FOUND_BOOK, ToolError } from './execute';

type UserErrorMember = {
  __typename: string;
  message?: string;
  issues?: Array<{ path: string[]; message: string }>;
  messages?: Array<{ severity: string; code: string; message: string; path?: string | null }>;
  validation?: { valid: boolean; threshold: string } | null;
  collidingBook?: { id: string; title: string } | null;
  limit?: number;
  existingRequestId?: string;
};

export const renderUserError = (member: UserErrorMember): string => {
  const lines = [`${member.__typename}: ${member.message ?? 'The request was refused'}`];
  if (member.issues !== undefined) {
    for (const issue of member.issues) {
      lines.push(`  - ${issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''}${issue.message}`);
    }
  }
  if (member.messages !== undefined) {
    for (const m of member.messages.slice(0, 5)) {
      lines.push(`  - ${m.severity} ${m.code}: ${m.message}${m.path ? ` (${m.path})` : ''}`);
    }
    if (member.messages.length > 5) lines.push(`  … and ${member.messages.length - 5} more`);
  }
  if (member.collidingBook) {
    lines.push(`  Colliding book: "${member.collidingBook.title}" id=${member.collidingBook.id}`);
  }
  if (member.existingRequestId !== undefined) {
    lines.push(`  Existing request id=${member.existingRequestId}`);
  }
  return lines.join('\n');
};

/**
 * `member` is the mutation field's value: null (the schema's "no such book"
 * convention), the payload, or a `UserError` member.
 */
export function unwrapPayload<P extends { __typename: string }>(
  member: ({ __typename: string } & Partial<UserErrorMember>) | null,
  payloadTypename: P['__typename']
): P {
  if (member === null) throw new ToolError(NOT_FOUND_BOOK);
  if (member.__typename !== payloadTypename) throw new ToolError(renderUserError(member));
  return member as P;
}

const ERROR_FRAGMENTS: Record<string, string> = {
  InvalidInputError: '... on InvalidInputError { issues { path message } }',
  EpubValidationError: '... on EpubValidationError { messages { severity code message path } }',
  BookNotValidatedError: '... on BookNotValidatedError { validation { valid threshold } }',
  BookHashCollisionError: '... on BookHashCollisionError { collidingBook { id title } }',
  DuplicateBookRequestError: '... on DuplicateBookRequestError { existingRequestId }',
  BookRequestLimitExceededError: '... on BookRequestLimitExceededError { limit }',
};

/**
 * The selection a write tool adds under its result union so `renderUserError`
 * has data. Per union, not one shared block: GraphQL refuses an inline
 * fragment on a type that is not a member of the union it sits in.
 */
export const userErrorFields = (members: readonly (keyof typeof ERROR_FRAGMENTS)[]): string =>
  ['... on UserError { message }', ...members.map((m) => ERROR_FRAGMENTS[m])].join('\n      ');
