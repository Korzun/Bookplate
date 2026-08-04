import { CombinedGraphQLErrors, ServerError } from '@apollo/client/errors';
import { SetContextLink } from '@apollo/client/link/context';
import { ErrorLink } from '@apollo/client/link/error';
import { from as observableFrom, mergeMap, throwError } from 'rxjs';

import { refreshAccessToken } from '~/lib/api-fetch';
import { getToken } from '~/lib/token';

/** Injects the stored access token. Composed AFTER the refresh link so a retry re-reads storage. */
export const createAuthLink = (): SetContextLink =>
  new SetContextLink(({ headers }) => {
    const token = getToken();
    return { headers: token ? { ...headers, authorization: `Bearer ${token}` } : headers };
  });

/**
 * One-shot refresh-and-retry, mirroring `apiFetch`'s own semantics. Reuses
 * `refreshAccessToken()`, which is already single-flight in-tab AND cross-tab
 * via `navigator.locks` — do not reimplement that coordination here.
 *
 * The `retried` context guard below is belt-and-braces, not the thing
 * preventing an infinite loop today: verified against @apollo/client 4.2.9,
 * `ErrorLink` never re-enters this handler for a failure produced by the
 * `forward(operation)` call inside it — the retry's own error propagates
 * straight to the caller instead of looping back through `errorHandler`. That
 * non-re-entrant behaviour is an implementation detail of the installed
 * version, not a documented contract, so the guard stays as a safeguard
 * against it changing.
 *
 * rxjs, NOT the snippet in the server spec's §C: Apollo v4 re-exports rxjs's
 * Observable verbatim, so there is no static `Observable.from` and no
 * `.flatMap`. rxjs 7 uses the standalone `from()` with `.pipe(mergeMap(...))`,
 * and its `throwError` takes a FACTORY, not a value.
 *
 * The `ServerError` branch is a defensive fallback: yoga answers Apollo's
 * negotiated Accept header with `application/graphql-response+json`, which
 * keeps `extensions.code` reachable even on a 401. If that ever regressed to
 * `application/json`, Apollo would throw an opaque ServerError instead — this
 * degrades rather than breaking.
 */
export const createRefreshLink = (): ErrorLink =>
  new ErrorLink(({ error, operation, forward }) => {
    const isAuth =
      (CombinedGraphQLErrors.is(error) &&
        error.errors.some((e) => e.extensions?.['code'] === 'UNAUTHENTICATED')) ||
      (ServerError.is(error) && error.statusCode === 401);

    if (!isAuth || operation.getContext()['retried'] === true) return;
    operation.setContext({ retried: true });

    return observableFrom(refreshAccessToken()).pipe(
      mergeMap((ok) => (ok ? forward(operation) : throwError(() => error)))
    );
  });
