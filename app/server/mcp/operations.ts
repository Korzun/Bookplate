/**
 * The fixed GraphQL operations behind the MCP tools, and the shapes they return.
 * See `mcp/graphql.ts` for why tools run GraphQL rather than calling services.
 *
 * The result types are written by hand for the selections below; they are not
 * generated. `operations.test.ts` executes every operation against a real
 * harness, so a selection that drifts from its type fails a test rather than
 * a tool call.
 */
import type { DocumentNode } from 'graphql';

import { operation } from './graphql';

export type Operation = DocumentNode;

// ── Shared selections ────────────────────────────────────────────────────────────────

const BOOK_SUMMARY = `
  fragment McpBookSummary on Book {
    id
    title
    author
    series { id name }
    seriesIndex
    publishDate
    pageCount
    progress { percentage }
  }
`;

const METADATA_FIX = `
  fragment McpMetadataFix on MetadataFix {
    field
    kind
    from
    to
    reason
  }
`;

const VALIDATION = `
  fragment McpValidation on Validation {
    valid
    validatedAt
    threshold
    counts { severity count }
    messages(first: $messageLimit) {
      edges { node { severity code message path line column } }
      pageInfo { hasNextPage }
    }
  }
`;

const BOOK_DETAIL = `
  fragment McpBookDetail on Book {
    id
    title
    titleSort
    author
    authorSort
    series { id name }
    seriesIndex
    publisher
    publishDate
    description
    subjects
    identifiers { scheme value }
    pageCount
    chapterCount
    size
    hasCover
    addedAt
    mtime
    progress { percentage currentChapter device timestamp }
    validation { ...McpValidation }
    pendingFix { state { proposals { ...McpMetadataFix } } }
  }
  ${VALIDATION}
  ${METADATA_FIX}
`;

const SERIES_SUMMARY = `
  fragment McpSeriesSummary on Series {
    id
    name
    author
    bookCount
    progressPercentage
  }
`;

const VALIDATION_MESSAGE = `
  fragment McpEpubValidationMessage on EpubValidationMessage {
    severity
    code
    message
    path
    line
    column
  }
`;

/** Every typed error a book mutation can answer with, in one selection. */
const USER_ERRORS = `
  fragment McpUserErrors on UserError {
    __typename
    message
    ... on InvalidInputError { issues { path message } }
    ... on EpubValidationError { messages { ...McpEpubValidationMessage } }
    ... on BookHashCollisionError { collidingBook { id title author } }
  }
  ${VALIDATION_MESSAGE}
`;

// ── Shapes ─────────────────────────────────────────────────────────────────────────

export type PageInfo = { hasNextPage: boolean; endCursor: string | null };
export type Connection<T> = { edges: { node: T }[]; pageInfo: PageInfo };

export type BookSummary = {
  __typename: 'Book';
  id: string;
  title: string;
  author: string;
  series: { id: string; name: string } | null;
  seriesIndex: number;
  publishDate: string;
  pageCount: number;
  progress: { percentage: number } | null;
};

export type MetadataFix = {
  field: string;
  kind: string;
  from: string;
  to: string | null;
  reason: string | null;
};

export type ValidationMessage = {
  severity: string;
  code: string;
  message: string;
  path: string | null;
  line: number | null;
  column: number | null;
};

export type Validation = {
  valid: boolean;
  validatedAt: string;
  threshold: string;
  counts: { severity: string; count: number }[];
  messages: { edges: { node: ValidationMessage }[]; pageInfo: { hasNextPage: boolean } };
};

export type BookDetail = {
  __typename: 'Book';
  id: string;
  title: string;
  titleSort: string;
  author: string;
  authorSort: string;
  series: { id: string; name: string } | null;
  seriesIndex: number;
  publisher: string;
  publishDate: string;
  description: string;
  subjects: string[];
  identifiers: { scheme: string; value: string }[];
  pageCount: number;
  chapterCount: number;
  size: number;
  hasCover: boolean;
  addedAt: string;
  mtime: string;
  progress: {
    percentage: number;
    currentChapter: number | null;
    device: string;
    timestamp: string;
  } | null;
  validation: Validation | null;
  pendingFix: { state: { proposals: MetadataFix[] } } | null;
};

export type SeriesSummary = {
  __typename: 'Series';
  id: string;
  name: string;
  author: string;
  bookCount: number;
  progressPercentage: number | null;
};

export type UserError = {
  __typename: string;
  message: string;
  issues?: { path: string[]; message: string }[];
  messages?: ValidationMessage[];
  collidingBook?: { id: string; title: string; author: string };
  existingRequestId?: string;
  limit?: number;
};

/** A book-mutation union: its payload type, or any `UserError` member. */
export type MutationResult<TPayload extends { __typename: string }> = TPayload | UserError;

export type BookRequest = {
  id: string;
  title: string;
  author: string;
  note: string;
  status: string;
  declineReason: string;
  createdAt: string;
  resolvedAt: string | null;
  book: { id: string; title: string } | null;
};

// ── Reads ──────────────────────────────────────────────────────────────────────────

export const SEARCH_LIBRARY = operation(`
  query McpSearchLibrary($first: Int!, $after: String, $filter: LibraryFilter) {
    viewer {
      library {
        entries(first: $first, after: $after, filter: $filter) {
          edges { node { __typename ...McpBookSummary ...McpSeriesSummary } }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
  ${BOOK_SUMMARY}
  ${SERIES_SUMMARY}
`);
export type SearchLibraryData = {
  viewer: { library: { entries: Connection<BookSummary | SeriesSummary> } | null };
};

export const GET_BOOK = operation(`
  query McpGetBook($id: ID!, $messageLimit: Int!) {
    node(id: $id) { __typename ...McpBookDetail }
  }
  ${BOOK_DETAIL}
`);
export type GetBookData = { node: BookDetail | { __typename: string } | null };

export const GET_SERIES_BY_ID = operation(`
  query McpGetSeriesById($id: ID!, $first: Int!, $after: String) {
    node(id: $id) {
      __typename
      ...McpSeriesSummary
      ... on Series {
        publisher
        subjects
        totalPages
        books(first: $first, after: $after) {
          edges { node { ...McpBookSummary } }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
  ${SERIES_SUMMARY}
  ${BOOK_SUMMARY}
`);

export const GET_SERIES_BY_NAME = operation(`
  query McpGetSeriesByName($name: String!, $first: Int!, $after: String) {
    viewer {
      library {
        seriesByName(name: $name) {
          __typename
          ...McpSeriesSummary
          publisher
          subjects
          totalPages
          books(first: $first, after: $after) {
            edges { node { ...McpBookSummary } }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    }
  }
  ${SERIES_SUMMARY}
  ${BOOK_SUMMARY}
`);
export type SeriesDetail = SeriesSummary & {
  publisher: string;
  subjects: string[];
  totalPages: number;
  books: Connection<BookSummary>;
};
export type GetSeriesByIdData = { node: SeriesDetail | { __typename: string } | null };
export type GetSeriesByNameData = {
  viewer: { library: { seriesByName: SeriesDetail | null } | null };
};

export const BOOK_FILE_INFO = operation(`
  query McpBookFileInfo($id: ID!) {
    node(id: $id) { __typename ... on Book { id title size } }
  }
`);
export type BookFileInfo = { __typename: 'Book'; id: string; title: string; size: number };
export type BookFileInfoData = { node: BookFileInfo | { __typename: string } | null };

export const LIST_BOOK_REQUESTS = operation(`
  query McpListBookRequests($first: Int!, $after: String, $status: BookRequestStatus) {
    viewer {
      user {
        pendingBookRequestCount
        bookRequests(first: $first, after: $after, status: $status) {
          edges {
            node {
              id title author note status declineReason createdAt resolvedAt
              book { id title }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
`);
export type ListBookRequestsData = {
  viewer: {
    user: { pendingBookRequestCount: number; bookRequests: Connection<BookRequest> } | null;
  };
};

// ── Writes ─────────────────────────────────────────────────────────────────────────

export const UPDATE_BOOK_METADATA = operation(`
  mutation McpUpdateBookMetadata($input: BookUpdateMetadataInput!, $messageLimit: Int!) {
    bookUpdateMetadata(input: $input) {
      __typename
      ... on BookUpdateMetadataPayload { book { ...McpBookDetail } }
      ...McpUserErrors
    }
  }
  ${BOOK_DETAIL}
  ${USER_ERRORS}
`);
export type UpdateBookMetadataData = {
  bookUpdateMetadata: MutationResult<{
    __typename: 'BookUpdateMetadataPayload';
    book: BookDetail;
  }> | null;
};

export const VALIDATE_BOOK = operation(`
  mutation McpValidateBook($input: BookValidateInput!, $messageLimit: Int!) {
    bookValidate(input: $input) {
      __typename
      ... on BookValidatePayload {
        book { id title }
        validation { ...McpValidation }
      }
    }
  }
  ${VALIDATION}
`);
export type ValidateBookData = {
  bookValidate: {
    __typename: 'BookValidatePayload';
    book: { id: string; title: string };
    validation: Validation;
  } | null;
};

export const ADD_BOOK = operation(`
  mutation McpAddBook($input: BookAddInput!, $messageLimit: Int!) {
    bookAdd(input: $input) {
      __typename
      ... on BookAddPayload {
        book { ...McpBookDetail }
        autoFixes { ...McpMetadataFix }
        proposals { ...McpMetadataFix }
      }
      ...McpUserErrors
    }
  }
  ${BOOK_DETAIL}
  ${USER_ERRORS}
`);
export type AddBookData = {
  bookAdd: MutationResult<{
    __typename: 'BookAddPayload';
    book: BookDetail;
    autoFixes: MetadataFix[];
    proposals: MetadataFix[];
  }>;
};

export const ANALYZE_REPLACEMENT = operation(`
  mutation McpAnalyzeReplacement($input: BookAnalyzeReplaceInput!) {
    bookAnalyzeReplace(input: $input) {
      __typename
      ... on BookAnalyzeReplacePayload {
        valid
        messages { ...McpEpubValidationMessage }
        autoFixes { ...McpMetadataFix }
        proposals { ...McpMetadataFix }
      }
      ...McpUserErrors
    }
  }
  ${METADATA_FIX}
  ${USER_ERRORS}
`);
export type AnalyzeReplacementData = {
  bookAnalyzeReplace: MutationResult<{
    __typename: 'BookAnalyzeReplacePayload';
    valid: boolean;
    messages: ValidationMessage[];
    autoFixes: MetadataFix[];
    proposals: MetadataFix[];
  }> | null;
};

export const REPLACE_BOOK = operation(`
  mutation McpReplaceBook($input: BookReplaceInput!, $messageLimit: Int!) {
    bookReplace(input: $input) {
      __typename
      ... on BookReplacePayload { book { ...McpBookDetail } }
      ...McpUserErrors
    }
  }
  ${BOOK_DETAIL}
  ${USER_ERRORS}
`);
export type ReplaceBookData = {
  bookReplace: MutationResult<{ __typename: 'BookReplacePayload'; book: BookDetail }> | null;
};

export const REQUEST_BOOK = operation(`
  mutation McpRequestBook($input: BookRequestCreateInput!) {
    bookRequestCreate(input: $input) {
      __typename
      ... on BookRequestCreatePayload {
        bookRequest {
          id title author note status declineReason createdAt resolvedAt
          book { id title }
        }
      }
      ... on DuplicateBookRequestError { existingRequestId }
      ... on BookRequestLimitExceededError { limit }
      ...McpUserErrors
    }
  }
  ${USER_ERRORS}
`);
export type RequestBookData = {
  bookRequestCreate: MutationResult<{
    __typename: 'BookRequestCreatePayload';
    bookRequest: BookRequest;
  }>;
};
