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
});
