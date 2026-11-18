import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { decodeGlobalID } from '@pothos/plugin-relay';
import { z } from 'zod';

import type { ToolDeps } from './deps';
import { executeDocument, guarded, ok, ToolError } from './execute';
import {
  BOOK_SUMMARY_FIELDS,
  bookSummarySchema,
  describeBook,
  summarizeBook,
  type BookSummaryGql,
} from './shared';

const COLLECTION_FIELDS = `
  id name bookCount
  books(first: 100) { edges { node { position book { ${BOOK_SUMMARY_FIELDS} } } } }
`;

type CollectionGql = {
  id: string;
  name: string;
  bookCount: number;
  books: { edges: Array<{ node: { position: number | null; book: BookSummaryGql } }> };
};

const BY_NAME = `
  query CollectionByName($name: String!) {
    viewer { library { collectionByName(name: $name) { ${COLLECTION_FIELDS} } } }
  }
`;
const BY_ID = `
  query CollectionById($id: ID!) {
    node(id: $id) { __typename ... on Collection { ${COLLECTION_FIELDS} } }
  }
`;

const NOT_FOUND_COLLECTION = 'No collection with that id or name in your library';

const isCollectionGlobalId = (id: string): boolean => {
  try {
    return decodeGlobalID(id).typename === 'Collection';
  } catch {
    return false;
  }
};

export function registerGetCollection(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'get_collection',
    {
      title: 'Get a collection',
      description:
        'A collection and its books in collection order. Collections are curated lists read from the ' +
        'book files (for example "Guardian 100"), distinct from series. Pass either `id` (from get_book) ' +
        'or the exact `name`. ' +
        'Returns at most the first 100 books; the text says when a collection is longer.',
      inputSchema: {
        id: z.string().optional(),
        name: z.string().max(500).optional(),
      },
      outputSchema: {
        id: z.string(),
        name: z.string(),
        bookCount: z.number(),
        books: z.array(
          bookSummarySchema.extend({
            position: z.number().nullable().describe('Place in this collection; null if unordered'),
          })
        ),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    (args) =>
      guarded(deps, {}, async () => {
        let collection: CollectionGql | null = null;
        if (args.id !== undefined) {
          if (!isCollectionGlobalId(args.id)) throw new ToolError(NOT_FOUND_COLLECTION);
          const data = await executeDocument<{
            node: ({ __typename: string } & CollectionGql) | null;
          }>(deps.context, BY_ID, { id: args.id });
          collection =
            data.node !== null && data.node.__typename === 'Collection' ? data.node : null;
        } else if (args.name !== undefined) {
          const data = await executeDocument<{
            viewer: { library: { collectionByName: CollectionGql | null } | null };
          }>(deps.context, BY_NAME, { name: args.name });
          collection = data.viewer.library?.collectionByName ?? null;
        } else {
          throw new ToolError('Pass id or name');
        }
        if (collection === null) throw new ToolError(NOT_FOUND_COLLECTION);
        const books = collection.books.edges.map(({ node }) => ({
          ...summarizeBook(node.book),
          position: node.position,
        }));
        const out = {
          id: collection.id,
          name: collection.name,
          bookCount: collection.bookCount,
          books,
        };
        const text = [
          `Collection "${out.name}" — ${out.bookCount} book(s), id=${out.id}`,
          ...(out.bookCount > books.length
            ? [`Showing first ${books.length} of ${out.bookCount}`]
            : []),
          ...books.map(
            (b) => `  ${b.position === null ? '–' : `${b.position}.`} ${describeBook(b)}`
          ),
        ].join('\n');
        return ok(text, out);
      })
  );
}
