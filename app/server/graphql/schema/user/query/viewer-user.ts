import { builder } from '../../builder';
import { model as viewer } from '../../viewer';
import { model } from '../index';

/**
 * The viewer's own `User` row — the bridge from the root singleton `Viewer`
 * (which is not a `Node`, and has no global ID) to a normalizable `User`
 * node, so Houdini can share one cached `User` between `viewer { user }` and
 * `users`/`node(id:)`.
 *
 * Null for the config-based admin, which has no row in the users table —
 * `RefreshToken.userId` is nullable precisely for it. Same null condition and
 * same reasoning as `Viewer.library` (`library/query/viewer-library.ts`).
 *
 * No scope beyond the builder default: this is by construction the viewer's
 * own row, exactly as `Viewer.library` is by construction the viewer's own
 * library. There is no id argument to check.
 */
builder.objectField(viewer, 'user', (t) =>
  t.prismaField({
    type: model,
    nullable: true,
    resolve: (query, v, _args, context) =>
      v.userId === null
        ? null
        : context.prisma.user.findUnique({ ...query, where: { id: v.userId } }),
  })
);
