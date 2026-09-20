import { ensureAdminUser } from '../../../services/admin-account';
import { setUserEmail } from '../../../services/email';
import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

type ViewerUserData = { viewer: { user: { id: string; username: string } | null } };

describe('Viewer.user', () => {
  it("resolves the viewer's own user row", async () => {
    const result = await harness.execute('{ viewer { user { id username } } }', {
      viewer: harness.aliceViewer,
    });

    expect(result.errors).toBeUndefined();
    const user = (result.data as ViewerUserData).viewer.user;
    expect(user?.username).toBe('alice');
    // The same global ID the schema mints for her elsewhere — this is the
    // bridge from the non-Node `Viewer` singleton to a normalizable node, so
    // an id that did not match would defeat the field's whole purpose.
    expect(user?.id).toBe(harness.aliceGlobalId);
  });

  it("resolves the OTHER viewer's row for that viewer, not a fixed one", async () => {
    const result = await harness.execute('{ viewer { user { username } } }', {
      viewer: harness.bobViewer,
    });

    expect(result.errors).toBeUndefined();
    expect((result.data as ViewerUserData).viewer.user?.username).toBe('bob');
  });

  it('is null for the config-based admin, which has no user row', async () => {
    const result = await harness.execute('{ viewer { username user { username } } }', {
      viewer: harness.adminViewer,
    });

    expect(result.errors).toBeUndefined();
    expect((result.data as ViewerUserData).viewer.user ?? null).toBeNull();
  });

  it('exposes the address on Viewer itself, so the admin can read their own', async () => {
    const adminId = await ensureAdminUser(harness.prisma, 'admin');
    await setUserEmail(harness.prisma, adminId, 'boss@example.com');

    const result = await harness.execute('{ viewer { email emailVerifiedAt user { id } } }', {
      viewer: harness.adminViewer,
    });

    type ViewerEmailData = {
      viewer: { email: string | null; emailVerifiedAt: string | null; user: unknown };
    };
    expect(result.errors).toBeUndefined();
    expect((result.data as ViewerEmailData).viewer.email).toBe('boss@example.com');
    expect((result.data as ViewerEmailData).viewer.emailVerifiedAt).toBeNull();
    // Viewer.user stays null for the admin — which is exactly why email cannot
    // live behind it.
    expect((result.data as ViewerEmailData).viewer.user).toBeNull();
  });
});
