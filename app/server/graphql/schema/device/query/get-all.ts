import { builder } from '../../builder';
import { model as viewer } from '../../viewer';
import { model } from '../index';

/**
 * Matches `routes/devices.ts`'s `GET /` exactly (see its handler and its own
 * comment: "Listing devices is open to any user ... creating, editing, and
 * deleting devices stay admin-only"). Every GraphQL field already requires an
 * authenticated viewer (the builder's default `authenticated` scope), so the
 * REST route's outer `requireAuth` is already covered — the branching below
 * reproduces the REST handler's OWN branching, not a tightened or loosened
 * version of it:
 *   - an admin sees every device;
 *   - a regular user sees only the devices they are enabled on;
 *   - a viewer with no userId (defensive; only the config-based admin has a
 *     null userId, and that case is already handled above) sees none.
 * Deliberately reads `context.prisma.device` directly rather than through
 * `context.stores.device.list()`/`listForUser()` — reads go through Prisma
 * directly in this schema (see the plan's "Layer boundaries" note), and it is
 * the only way to get `t.prismaField`'s `query` select-merging plus the
 * `createdAt`/`updatedAt` columns, which `DeviceStore`'s `Device` DTO
 * (`app/server/types.ts`) does not carry.
 */
builder.objectField(viewer, 'devices', (t) =>
  t.prismaField({
    type: [model],
    resolve: (query, viewerRow, _args, context) => {
      if (viewerRow.isAdmin) {
        return context.prisma.device.findMany({ ...query, orderBy: { name: 'asc' } });
      }
      if (viewerRow.userId === null) return [];
      return context.prisma.device.findMany({
        ...query,
        where: { enabledUsers: { some: { userId: viewerRow.userId } } },
        orderBy: { name: 'asc' },
      });
    },
  })
);
