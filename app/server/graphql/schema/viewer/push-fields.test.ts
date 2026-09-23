import { MAX_PUSH_SUBSCRIPTIONS_PER_USER } from '../../../../services/push-subscription';
import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;

afterEach(async () => {
  await harness.cleanup();
});

describe('Viewer.pushPublicKey', () => {
  it('hands the browser the VAPID public key', async () => {
    harness = await createHarness();

    const result = await harness.execute(`{ viewer { pushPublicKey } }`, {
      viewer: harness.aliceViewer,
    });

    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({ viewer: { pushPublicKey: harness.vapidPublicKey } });
  });

  it('requires authentication', async () => {
    harness = await createHarness();

    const result = await harness.execute(`{ viewer { pushPublicKey } }`, { viewer: null });

    expect(result.errors).toBeDefined();
  });
});

describe('Viewer.pushSubscriptions and mutations', () => {
  it('stores a subscription and lists it back without the endpoint', async () => {
    harness = await createHarness();

    const added = await harness.execute(
      `mutation {
         viewerAddPushSubscription(
           endpoint: "https://push.example/a", p256dh: "k", auth: "s", label: "Chrome on macOS"
         ) { id label lastSuccessAt }
       }`,
      { viewer: harness.aliceViewer }
    );

    expect(added.errors).toBeUndefined();
    const addedPayload = added.data as {
      viewerAddPushSubscription: { id: string; label: string; lastSuccessAt: number | null };
    };
    expect(addedPayload.viewerAddPushSubscription.label).toBe('Chrome on macOS');
    expect(addedPayload.viewerAddPushSubscription.lastSuccessAt).toBeNull();

    const listed = await harness.execute(`{ viewer { pushSubscriptions { id label } } }`, {
      viewer: harness.aliceViewer,
    });

    expect(listed.errors).toBeUndefined();
    const listedPayload = listed.data as {
      viewer: { pushSubscriptions: { id: string; label: string }[] };
    };
    expect(listedPayload.viewer.pushSubscriptions).toHaveLength(1);
  });

  it('exposes no endpoint field at all', async () => {
    // A push endpoint is a bearer capability URL. Asserting the FIELD does not
    // exist, not merely that it is null, is what stops it being added back.
    harness = await createHarness();

    const result = await harness.execute(`{ viewer { pushSubscriptions { endpoint } } }`, {
      viewer: harness.aliceViewer,
    });

    expect(result.errors?.[0]?.message).toMatch(/Cannot query field "endpoint"/);
  });

  it("refuses to remove another account's subscription", async () => {
    harness = await createHarness();

    const added = await harness.execute(
      `mutation {
         viewerAddPushSubscription(
           endpoint: "https://push.example/a", p256dh: "k", auth: "s", label: "Chrome"
         ) { id }
       }`,
      { viewer: harness.aliceViewer }
    );
    const addedPayload = added.data as { viewerAddPushSubscription: { id: string } };
    const id = addedPayload.viewerAddPushSubscription.id;

    const denied = await harness.execute(`mutation { viewerRemovePushSubscription(id: "${id}") }`, {
      viewer: harness.bobViewer,
    });
    expect(denied.errors).toBeUndefined();
    expect(denied.data).toEqual({ viewerRemovePushSubscription: false });

    const allowed = await harness.execute(
      `mutation { viewerRemovePushSubscription(id: "${id}") }`,
      { viewer: harness.aliceViewer }
    );
    expect(allowed.errors).toBeUndefined();
    expect(allowed.data).toEqual({ viewerRemovePushSubscription: true });
  });

  it('requires authentication', async () => {
    harness = await createHarness();

    const result = await harness.execute(
      `mutation {
         viewerAddPushSubscription(
           endpoint: "https://push.example/a", p256dh: "k", auth: "s", label: "Chrome"
         ) { id }
       }`,
      { viewer: null }
    );

    expect(result.errors).toBeDefined();
  });

  describe('input validation (I-3, 3a)', () => {
    const add = (
      args: Partial<{ endpoint: string; p256dh: string; auth: string; label: string }> = {}
    ) => {
      const a = {
        endpoint: 'https://push.example/a',
        p256dh: 'k',
        auth: 's',
        label: 'Chrome',
        ...args,
      };
      return harness.execute(
        `mutation Add($endpoint: String!, $p256dh: String!, $auth: String!, $label: String!) {
           viewerAddPushSubscription(endpoint: $endpoint, p256dh: $p256dh, auth: $auth, label: $label) {
             id
           }
         }`,
        { viewer: harness.aliceViewer, variables: a }
      );
    };

    it('rejects an endpoint that is not a URL at all', async () => {
      harness = await createHarness();

      const result = await add({ endpoint: 'not-a-url' });

      expect(result.errors).toBeUndefined();
      expect(result.data).toEqual({ viewerAddPushSubscription: null });
      expect(await harness.prisma.pushSubscription.count()).toBe(0);
    });

    it('rejects a non-https endpoint — the SSRF/LAN exposure this check closes', async () => {
      harness = await createHarness();

      const result = await add({ endpoint: 'http://192.168.1.1/admin' });

      expect(result.data).toEqual({ viewerAddPushSubscription: null });
      expect(await harness.prisma.pushSubscription.count()).toBe(0);
    });

    it(
      'rejects an empty p256dh — the reachable case that used to be storable and, per web-push, ' +
        'never gets pruned (a pre-flight Error with no statusCode classifies transient)',
      async () => {
        harness = await createHarness();

        const result = await add({ p256dh: '' });

        expect(result.data).toEqual({ viewerAddPushSubscription: null });
        expect(await harness.prisma.pushSubscription.count()).toBe(0);
      }
    );

    it('rejects an empty auth for the identical reason', async () => {
      harness = await createHarness();

      const result = await add({ auth: '' });

      expect(result.data).toEqual({ viewerAddPushSubscription: null });
      expect(await harness.prisma.pushSubscription.count()).toBe(0);
    });

    it('rejects a p256dh outside the base64url charset', async () => {
      harness = await createHarness();

      const result = await add({ p256dh: 'not base64url! /+=' });

      expect(result.data).toEqual({ viewerAddPushSubscription: null });
      expect(await harness.prisma.pushSubscription.count()).toBe(0);
    });

    it('rejects a label over 100 characters', async () => {
      harness = await createHarness();

      const result = await add({ label: 'x'.repeat(101) });

      expect(result.data).toEqual({ viewerAddPushSubscription: null });
      expect(await harness.prisma.pushSubscription.count()).toBe(0);
    });

    it('rejects an endpoint over 2048 characters', async () => {
      harness = await createHarness();

      const result = await add({ endpoint: `https://push.example/${'a'.repeat(2048)}` });

      expect(result.data).toEqual({ viewerAddPushSubscription: null });
      expect(await harness.prisma.pushSubscription.count()).toBe(0);
    });

    it('still accepts well-formed input', async () => {
      harness = await createHarness();

      const result = await add();

      expect(result.errors).toBeUndefined();
      expect(
        (result.data as { viewerAddPushSubscription: { id: string } | null })
          .viewerAddPushSubscription
      ).not.toBeNull();
      expect(await harness.prisma.pushSubscription.count()).toBe(1);
    });
  });

  describe('the per-user cap (I-3, 3b)', () => {
    it('refuses a new device once the caller is already at the cap', async () => {
      harness = await createHarness();

      for (let i = 0; i < MAX_PUSH_SUBSCRIPTIONS_PER_USER; i++) {
        const result = await harness.execute(
          `mutation {
             viewerAddPushSubscription(
               endpoint: "https://push.example/device-${i}", p256dh: "k", auth: "s", label: "Chrome"
             ) { id }
           }`,
          { viewer: harness.aliceViewer }
        );
        expect(result.errors).toBeUndefined();
      }

      const overCap = await harness.execute(
        `mutation {
           viewerAddPushSubscription(
             endpoint: "https://push.example/one-too-many", p256dh: "k", auth: "s", label: "Chrome"
           ) { id }
         }`,
        { viewer: harness.aliceViewer }
      );

      expect(overCap.data).toEqual({ viewerAddPushSubscription: null });
      expect(await harness.prisma.pushSubscription.count()).toBe(MAX_PUSH_SUBSCRIPTIONS_PER_USER);
    });
  });
});
