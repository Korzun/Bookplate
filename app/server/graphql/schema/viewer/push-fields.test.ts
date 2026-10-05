import { MAX_PUSH_SUBSCRIPTIONS_PER_USER } from '../../../services/push-subscription';
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

    it('rejects a non-https endpoint', async () => {
      harness = await createHarness();

      const result = await add({ endpoint: 'http://192.168.1.1/admin' });

      expect(result.data).toEqual({ viewerAddPushSubscription: null });
      expect(await harness.prisma.pushSubscription.count()).toBe(0);
    });

    /**
     * The endpoint is a bearer capability URL this server POSTs to on every
     * notification, so an arbitrary one is a blind SSRF primitive aimed at the
     * install's own network — reachable by any authenticated account. `https:`
     * alone never bounded that: every address below is a perfectly valid
     * https URL.
     */
    it.each([
      ['loopback', 'https://127.0.0.1/admin'],
      ['private class A', 'https://10.0.0.5/admin'],
      ['private class B', 'https://172.16.4.2/admin'],
      ['private class C', 'https://192.168.1.1/admin'],
      ['link-local', 'https://169.254.169.254/latest/meta-data'],
      ['IPv6 loopback', 'https://[::1]/admin'],
      ['IPv6 unique-local', 'https://[fd00::1]/admin'],
      ['IPv4-mapped IPv6', 'https://[::ffff:192.168.1.1]/admin'],
      ['mDNS name', 'https://nas.local/admin'],
      ['router domain', 'https://printer.lan/admin'],
      ['bare hostname', 'https://nas/admin'],
      ['localhost', 'https://localhost/admin'],
    ])('rejects an https endpoint on a private host (%s)', async (_label, endpoint) => {
      harness = await createHarness();

      const result = await add({ endpoint });

      expect(result.data).toEqual({ viewerAddPushSubscription: null });
      expect(await harness.prisma.pushSubscription.count()).toBe(0);
    });

    /**
     * The real push services, which must keep working. A regression here
     * would not fail loudly — it would quietly stop every device registering.
     */
    it.each([
      ['Apple', 'https://web.push.apple.com/QGaj0UFZT1DeN1rTEO'],
      ['Mozilla', 'https://updates.push.services.mozilla.com/wpush/v2/gAAAA'],
      ['Google', 'https://fcm.googleapis.com/fcm/send/abc123'],
    ])('accepts a real push service endpoint (%s)', async (_label, endpoint) => {
      harness = await createHarness();

      const result = await add({ endpoint });

      expect(result.data?.viewerAddPushSubscription).not.toBeNull();
    });

    /**
     * States the limit rather than hiding it: nothing here resolves DNS, so a
     * PUBLIC name pointing at a private address still passes. Resolving in a
     * validator would add network I/O and still lose to rebinding — the real
     * fix is an address check at connect time, in the driver's HTTP agent.
     * This test exists so that gap is a recorded decision, not a surprise.
     */
    it('does NOT reject a public name that could resolve privately — a known gap', async () => {
      harness = await createHarness();

      const result = await add({ endpoint: 'https://localtest.me/admin' });

      expect(result.data?.viewerAddPushSubscription).not.toBeNull();
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
