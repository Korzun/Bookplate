import { ensureAdminUser } from '../../../services/admin-account';
import { setNotificationPreference } from '../../../services/notification';
import { createHarness, MAIL_CONFIG, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;

const QUERY = '{ viewer { notificationPreferences { event channel enabled } } }';

afterEach(async () => {
  await harness.cleanup();
});

describe('Viewer.notificationPreferences', () => {
  it('gives a reader the two outcome events, enabled by default', async () => {
    harness = await createHarness({ mail: MAIL_CONFIG });

    const result = await harness.execute(QUERY);

    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({
      viewer: {
        notificationPreferences: [
          { event: 'BOOK_REQUEST_FULFILLED', channel: 'EMAIL', enabled: true },
          { event: 'BOOK_REQUEST_DECLINED', channel: 'EMAIL', enabled: true },
        ],
      },
    });
  });

  it('reflects a stored opt-out', async () => {
    harness = await createHarness({ mail: MAIL_CONFIG });
    await setNotificationPreference(harness.prisma, {
      userId: harness.aliceOwner.userId,
      event: 'book_request.declined',
      channel: 'email',
      enabled: false,
    });

    const result = await harness.execute(QUERY);

    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({
      viewer: {
        notificationPreferences: [
          { event: 'BOOK_REQUEST_FULFILLED', channel: 'EMAIL', enabled: true },
          { event: 'BOOK_REQUEST_DECLINED', channel: 'EMAIL', enabled: false },
        ],
      },
    });
  });

  it('gives the config admin only the created event', async () => {
    harness = await createHarness({ mail: MAIL_CONFIG });
    await ensureAdminUser(harness.prisma, 'admin');

    const result = await harness.execute(QUERY, { viewer: harness.adminViewer });

    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({
      viewer: {
        notificationPreferences: [
          { event: 'BOOK_REQUEST_CREATED', channel: 'EMAIL', enabled: true },
        ],
      },
    });
  });

  it('is empty on an install with no mail configured', async () => {
    harness = await createHarness();

    const result = await harness.execute(QUERY);

    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({ viewer: { notificationPreferences: [] } });
  });
});

describe('viewerSetNotificationPreference', () => {
  const MUTATION = `
    mutation Set($enabled: Boolean!) {
      viewerSetNotificationPreference(
        event: BOOK_REQUEST_DECLINED
        channel: EMAIL
        enabled: $enabled
      ) {
        notificationPreferences { event enabled }
      }
    }
  `;

  it('stores an opt-out and returns the updated catalogue', async () => {
    harness = await createHarness({ mail: MAIL_CONFIG });

    const result = await harness.execute(MUTATION, { variables: { enabled: false } });

    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({
      viewerSetNotificationPreference: {
        notificationPreferences: [
          { event: 'BOOK_REQUEST_FULFILLED', enabled: true },
          { event: 'BOOK_REQUEST_DECLINED', enabled: false },
        ],
      },
    });
  });

  it('is idempotent when re-enabling', async () => {
    harness = await createHarness({ mail: MAIL_CONFIG });

    await harness.execute(MUTATION, { variables: { enabled: false } });
    await harness.execute(MUTATION, { variables: { enabled: true } });
    await harness.execute(MUTATION, { variables: { enabled: true } });

    expect(await harness.prisma.notificationPreference.count()).toBe(1);
  });

  it('writes the config admin’s own row, not a reader’s', async () => {
    harness = await createHarness({ mail: MAIL_CONFIG });
    await ensureAdminUser(harness.prisma, 'admin');

    const result = await harness.execute(
      `mutation {
         viewerSetNotificationPreference(
           event: BOOK_REQUEST_CREATED
           channel: EMAIL
           enabled: false
         ) {
           notificationPreferences { event enabled }
         }
       }`,
      { viewer: harness.adminViewer }
    );

    expect(result.errors).toBeUndefined();
    const rows = await harness.prisma.notificationPreference.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).not.toBe(harness.aliceOwner.userId);
    expect(rows[0].event).toBe('book_request.created');
  });
});
