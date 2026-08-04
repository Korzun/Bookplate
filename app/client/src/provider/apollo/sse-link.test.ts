import { gql } from '@apollo/client';
import { print } from '@apollo/client/utilities';
import { describe, expect, it, vi } from 'vitest';

const SUBSCRIPTION = gql`
  subscription ScanProgress($libraryId: ID!) {
    scanProgress(libraryId: $libraryId) {
      id
      processed
    }
  }
`;

/**
 * Captures what the link hands to graphql-sse without opening a real stream.
 *
 * `vi.resetModules()` is required before each `vi.doMock` here: `./sse-link`
 * is dynamically imported per-test, and without resetting the module
 * registry the second and third tests would resolve the already-cached
 * module from the first test's import — whose closure holds the FIRST test's
 * `calls` array — so the new mock would never be observed.
 */
const captureSubscribeCall = () => {
  vi.resetModules();
  const calls: Record<string, unknown>[] = [];
  vi.doMock('graphql-sse', () => ({
    createClient: (options: { headers: () => Promise<Record<string, string>> }) => ({
      subscribe: (payload: Record<string, unknown>, sink: { complete: () => void }) => {
        calls.push({ payload, headers: options.headers });
        sink.complete();
        return () => {};
      },
      dispose: () => {},
    }),
  }));
  return calls;
};

describe('SSELink', () => {
  // SEEN-TO-FAIL: must fail if the implementation spreads `{ ...operation }`.
  // Apollo v4 hangs an `operationType` property off the operation object and
  // yoga rejects unknown body parameters outright — asserting the EXACT key set
  // is what catches it; asserting "a subscription works" would not.
  it('sends exactly query/variables/operationName/extensions — never operationType', async () => {
    const calls = captureSubscribeCall();
    const { SSELink: FreshLink } = await import('./sse-link');

    const link = new FreshLink({ url: '/graphql', getToken: async () => 'tok' });
    await new Promise<void>((resolve) => {
      link
        .request({
          query: SUBSCRIPTION,
          variables: { libraryId: 'LIB-1' },
          operationName: 'ScanProgress',
          operationType: 'subscription',
          extensions: {},
          getContext: () => ({}),
          setContext: () => {},
        } as never)!
        .subscribe({ complete: resolve, error: resolve });
    });

    expect(calls).toHaveLength(1);
    const payload = calls[0]['payload'] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      'extensions',
      'operationName',
      'query',
      'variables',
    ]);
    expect(payload['query']).toBe(print(SUBSCRIPTION));
    expect(payload['variables']).toEqual({ libraryId: 'LIB-1' });
  });

  it('supplies a bearer header from the async token callback', async () => {
    const calls = captureSubscribeCall();
    const { SSELink: FreshLink } = await import('./sse-link');

    const link = new FreshLink({ url: '/graphql', getToken: async () => 'tok-abc' });
    await new Promise<void>((resolve) => {
      link
        .request({
          query: SUBSCRIPTION,
          variables: { libraryId: 'LIB-1' },
          operationName: 'ScanProgress',
          operationType: 'subscription',
          extensions: {},
          getContext: () => ({}),
          setContext: () => {},
        } as never)!
        .subscribe({ complete: resolve, error: resolve });
    });

    const headers = calls[0]['headers'] as () => Promise<Record<string, string>>;
    expect(await headers()).toEqual({ authorization: 'Bearer tok-abc' });
  });

  it('sends no authorization header when there is no token', async () => {
    const calls = captureSubscribeCall();
    const { SSELink: FreshLink } = await import('./sse-link');

    const link = new FreshLink({ url: '/graphql', getToken: async () => null });
    await new Promise<void>((resolve) => {
      link
        .request({
          query: SUBSCRIPTION,
          variables: {},
          operationName: 'ScanProgress',
          operationType: 'subscription',
          extensions: {},
          getContext: () => ({}),
          setContext: () => {},
        } as never)!
        .subscribe({ complete: resolve, error: resolve });
    });

    const headers = calls[0]['headers'] as () => Promise<Record<string, string>>;
    expect(await headers()).toEqual({});
  });
});
