import { ApolloLink, Observable, type FetchResult, type Operation } from '@apollo/client';
import { print } from '@apollo/client/utilities';
import { createClient, type Client } from 'graphql-sse';

/**
 * Apollo ships no SSE link. This is Apollo's own GraphQLWsLink implementation
 * (`@apollo/client/link/subscriptions`) reduced to the one method graphql-sse's
 * client actually provides — `subscribe`.
 *
 * Why not use GraphQLWsLink directly? It works at runtime (verified against
 * graphql-yoga 5.21.2), but graphql-sse's `Client<false>` is missing `on` and
 * `terminate`, so the constructor is a TYPE error. Adopting it would mean
 * `as unknown as Client` plus installing `graphql-ws` purely to satisfy a .d.ts
 * it never executes — and the cast is only safe because the link happens to
 * touch one method today. A future Apollo release calling `terminate()` during
 * cleanup would break it silently on the disconnect path.
 *
 * The explicit destructure below is load-bearing. Apollo v4 hangs an
 * `operationType` property off `operation`; graphql-sse's README recipe spreads
 * `{ ...operation }`, which puts it in the request body, and yoga rejects
 * unknown body parameters with a confusing 400.
 *
 * Auth is a non-problem because graphql-sse uses `fetch`, not `EventSource`:
 * a real Authorization header works and the `headers` callback may be async.
 */
export class SSELink extends ApolloLink {
  private readonly client: Client;

  constructor(options: { url: string; getToken: () => Promise<string | null> }) {
    super();
    this.client = createClient({
      url: options.url,
      // Annotated: the ternary would otherwise widen to a union including
      // `{ authorization?: undefined }`, which is not a Record<string, string>.
      headers: async (): Promise<Record<string, string>> => {
        const token = await options.getToken();
        return token ? { authorization: `Bearer ${token}` } : {};
      },
    });
  }

  request(operation: Operation): Observable<FetchResult> {
    return new Observable((observer) => {
      const { variables, operationName, extensions } = operation;
      return this.client.subscribe<Record<string, unknown>>(
        { variables, operationName, extensions, query: print(operation.query) },
        {
          next: (value) => observer.next(value as FetchResult),
          complete: () => observer.complete(),
          error: (err) => observer.error(err instanceof Error ? err : new Error(String(err))),
        }
      );
    });
  }
}
