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

describe('Viewer.email / Viewer.emailVerifiedAt', () => {
  it('issues one row query for a viewer request selecting both fields', async () => {
    await setUserEmail(harness.prisma, harness.aliceOwner.userId, 'alice@example.com');
    const findUniqueSpy = vi.spyOn(harness.prisma.user, 'findUnique');

    const result = await harness.execute('{ viewer { email emailVerifiedAt } }');

    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({ viewer: { email: 'alice@example.com', emailVerifiedAt: null } });
    expect(findUniqueSpy).toHaveBeenCalledTimes(1);
    findUniqueSpy.mockRestore();
  });

  it('still resolves the config admin (no sub) via the isConfigAdmin fallback', async () => {
    const findFirstSpy = vi.spyOn(harness.prisma.user, 'findFirst');

    const result = await harness.execute('{ viewer { email emailVerifiedAt } }', {
      viewer: harness.adminViewer,
    });

    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({ viewer: { email: null, emailVerifiedAt: null } });
    expect(findFirstSpy).toHaveBeenCalledTimes(1);
    findFirstSpy.mockRestore();
  });
});
