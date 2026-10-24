import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ToolDeps } from './deps';
import { executeDocument, guarded, ok } from './execute';
import {
  clampFirst,
  nextCursorOf,
  nextCursorSchema,
  PAGE_INFO_FIELDS,
  type PageInfoGql,
} from './shared';

export const BOOK_REQUEST_FIELDS = `
  id title author note status declineReason createdAt resolvedAt
  book { id title }
`;

export type BookRequestGql = {
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

export const bookRequestSchema = z.object({
  id: z.string(),
  title: z.string(),
  author: z.string(),
  note: z.string(),
  status: z.string(),
  declineReason: z.string(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
  bookId: z.string().nullable().describe('The library book that fulfilled it, if any'),
});

export const toBookRequest = (r: BookRequestGql) => ({
  id: r.id,
  title: r.title,
  author: r.author,
  note: r.note,
  status: r.status,
  declineReason: r.declineReason,
  createdAt: r.createdAt,
  resolvedAt: r.resolvedAt,
  bookId: r.book?.id ?? null,
});

export const describeBookRequest = (r: ReturnType<typeof toBookRequest>): string =>
  `"${r.title}" by ${r.author} — ${r.status}${r.declineReason ? ` (${r.declineReason})` : ''} id=${r.id}`;

const DOCUMENT = `
  query BookRequests($first: Int, $after: String, $status: BookRequestStatus) {
    viewer {
      user {
        bookRequests(first: $first, after: $after, status: $status) {
          ${PAGE_INFO_FIELDS}
          edges { node { ${BOOK_REQUEST_FIELDS} } }
        }
      }
    }
  }
`;

type Result = {
  viewer: {
    user: {
      bookRequests: { pageInfo: PageInfoGql; edges: Array<{ node: BookRequestGql }> };
    } | null;
  };
};

export function registerListBookRequests(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'list_book_requests',
    {
      title: 'List book requests',
      description: 'Books you have asked the library admin for, newest first, with their status.',
      inputSchema: {
        status: z.enum(['PENDING', 'FULFILLED', 'DECLINED']).optional(),
        first: z.number().int().min(1).max(50).optional().describe('Default 20'),
        after: z.string().optional(),
      },
      outputSchema: { requests: z.array(bookRequestSchema), nextCursor: nextCursorSchema },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    (args) =>
      guarded(deps, {}, async () => {
        const data = await executeDocument<Result>(deps.context, DOCUMENT, {
          first: clampFirst(args.first, 20, 50),
          after: args.after,
          status: args.status,
        });
        const connection = data.viewer.user?.bookRequests;
        const requests = (connection?.edges ?? []).map(({ node }) => toBookRequest(node));
        const nextCursor = connection ? nextCursorOf(connection.pageInfo) : null;
        const text =
          requests.length === 0
            ? 'No book requests.'
            : requests.map(describeBookRequest).join('\n');
        return ok(text, { requests, nextCursor });
      })
  );
}
