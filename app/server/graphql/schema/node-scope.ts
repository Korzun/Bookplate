import type { Context, Viewer } from '../context';

/**
 * A userId that cannot exist, used to build a where-clause guaranteed to match
 * no row. Denials resolve the node field to null — indistinguishable from a
 * nonexistent id.
 *
 * Deliberately NOT the requesting viewer's own userId: book ids are content
 * hashes (partial MD5), so two users routinely hold the same id for the same
 * file, and substituting would silently return a different, valid row. For the
 * same reason denial must not throw — confirming the row exists would leak
 * "another user has this exact file".
 */
export const NO_MATCH_USER_ID = 'no-such-user';

/**
 * The shared "can this viewer reach this row" rule for every simple-id node
 * type: an admin, or the row's own owner. `User`'s `findUnique`, `Library`'s
 * `loadOne`, and `ownerScopedFindUnique`'s compound-key path all defer to this
 * one expression of the rule rather than each carrying its own copy.
 *
 * Intentional exception: `series/node-loader.ts`'s `findUnique`. This
 * function answers "may this viewer act on data owned by *this claimed*
 * userId" — it needs a candidate owner to test against, which `User` (the id
 * IS the userId), `Library` (same), and `ownerScopedFindUnique` (parses one
 * out of the compound id) all have synchronously, for free, before touching
 * the database. `Series` has a plain, opaque `@id` with no userId encoded in
 * it, so there is no claimed owner to hand this function without an extra
 * lookup first — there is only the viewer's own userId, which the guard uses
 * to constrain the query rather than to compare against a claim. Forcing that
 * through `isOwnerOrAdmin(viewer, viewer.userId)` would be a tautology (a
 * viewer's own userId always equals itself), not a use of the rule. See
 * `series/node-loader.ts` for the actual logic.
 */
export const isOwnerOrAdmin = (viewer: Viewer | null, userId: string): boolean =>
  viewer !== null && (viewer.isAdmin || viewer.userId === userId);

/**
 * Parses the local id `ownerScopedFindUnique` actually receives at runtime for
 * a `prismaNode('Type', { id: { field: 'userId_id' } })` registration.
 *
 * NOT `userId:id`. Pothos's default compound-id serializer
 * (`getDefaultIDSerializer` in @pothos/plugin-prisma, used whenever `id.field`
 * names a compound `@@id`/`@@unique` and no custom `resolve` overrides it)
 * produces `JSON.stringify([userIdValue, idValue])`, and a custom
 * `findUnique(id, context)` receives that same string with the `TypeName:`
 * prefix and base64 wrapper already stripped by the relay plugin. Confirmed by
 * instrumenting a real `prismaNode('Book', { id: { field: 'userId_id' } })`
 * and logging the `id` a custom `findUnique` received for a real encoded
 * global id: `["<userId>","<bookId>"]`, not `<userId>:<bookId>`.
 */
const parseCompoundId = (raw: string): readonly [userId: string, id: string] | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== 'string' ||
    typeof parsed[1] !== 'string'
  ) {
    return null;
  }
  return [parsed[0], parsed[1]];
};

/**
 * Wraps a compound-key where-clause builder so the row is only reachable by its
 * owner or an admin.
 *
 * WHY THIS EXISTS: prismaNode's default lookup takes the userId half of the
 * compound key from the caller's own global ID, so without this every tenant-
 * owned node type is a cross-tenant read. Every such type must pass its
 * findUnique through here; node-scope.test.ts enforces that generically.
 */
export const ownerScopedFindUnique =
  <W>(build: (userId: string, id: string) => W) =>
  (localId: string, context: Context): W => {
    const parsed = parseCompoundId(localId);
    if (parsed === null) return build(NO_MATCH_USER_ID, localId);

    const [userId, id] = parsed;

    const allowed = isOwnerOrAdmin(context.viewer, userId);

    return allowed ? build(userId, id) : build(NO_MATCH_USER_ID, id);
  };
