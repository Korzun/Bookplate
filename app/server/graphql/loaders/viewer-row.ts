import type { Prisma, PrismaClient } from '@prisma/client';

import type { Viewer } from '../context';

/**
 * Fixed to the two columns `Viewer.email` and `Viewer.emailVerifiedAt` read
 * (`schema/viewer/model.ts`) — this loader exists for exactly those two
 * fields, not as a general select-aware cache. A `resolveViewerRow` caller
 * that needs a different column (e.g. `resolve-user-id.ts`'s `{ id: true }`)
 * keeps calling `resolveViewerRow` directly; growing this to a third column
 * is a one-line addition here, not a reason to key the cache by select.
 */
const VIEWER_ROW_SELECT = { email: true, emailVerifiedAt: true } satisfies Prisma.UserSelect;

export type ViewerRow = Prisma.UserGetPayload<{ select: typeof VIEWER_ROW_SELECT }>;

export type ViewerRowLoader = () => Promise<ViewerRow | null>;

/**
 * Memoizes the one row lookup `Viewer.email` and `Viewer.emailVerifiedAt`
 * both need, for the life of one request — so a `viewer { email
 * emailVerifiedAt }` selection (what `ViewerBootstrapDocument` makes on
 * every app load) issues one query instead of two independent
 * `resolveViewerRow` calls.
 *
 * Mirrors `resolveViewerRow`'s dispatch exactly (I3, whole-branch review —
 * see `resolve-row.ts`'s doc comment): by `viewer.userId` when the token
 * carries a `sub`, else by the `isConfigAdmin` flag for the config-based
 * admin, NEVER by `viewer.username`.
 *
 * READ PATH ONLY — do not wire this into a mutation. `viewerSetEmail` and
 * `viewerConfirmEmail` write this same row and then read it back to build
 * their payloads; both do so with their own direct `context.prisma.user`
 * queries (via `resolveViewerUserId`, which still calls `resolveViewerRow`
 * directly), never through this loader. A fresh loader is built per request
 * in `createContext`, same as every loader in this directory — that
 * protects a memoized entry from going stale ACROSS requests, but it does
 * nothing for a write followed by a read within the SAME request, since the
 * promise would already be cached (or in flight) with the pre-write value.
 * Keeping the mutations off this loader entirely sidesteps that risk rather
 * than relying on request-scoping to prevent it.
 *
 * `viewer` is captured once, at loader-construction time in `createContext`
 * (or the equivalent test-harness context builders), matching every other
 * loader in this directory taking its scope from the request it was built
 * for.
 */
export const createViewerRowLoader = (
  prisma: PrismaClient,
  viewer: Viewer | null
): ViewerRowLoader => {
  let pending: Promise<ViewerRow | null> | undefined;

  return async (): Promise<ViewerRow | null> => {
    if (pending !== undefined) return pending;

    if (viewer === null) {
      throw new Error('createViewerRowLoader called without an authenticated viewer');
    }

    pending =
      viewer.userId !== null
        ? prisma.user.findUnique({ where: { id: viewer.userId }, select: VIEWER_ROW_SELECT })
        : prisma.user.findFirst({ where: { isConfigAdmin: true }, select: VIEWER_ROW_SELECT });
    return pending;
  };
};
