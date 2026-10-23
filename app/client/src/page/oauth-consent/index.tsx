import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

import { BrandLockup, Card, Page } from '~/component';
import { Button } from '~/control';
import { apiFetch } from '~/lib/api-fetch';
import { useToast } from '~/provider/toast';

import { useStyle } from './style';

type ConsentDetails = {
  clientName: string;
  clientUri: string | null;
  redirectHost: string;
  username: string;
  libraryName: string;
};

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; details: ConsentDetails };

const errorMessage = async (response: Response, fallback: string): Promise<string> => {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : fallback;
  } catch {
    return fallback;
  }
};

/**
 * Where a reader approves (or turns down) an AI agent that wants to reach
 * their library over MCP. The agent's OAuth sign-in sends the browser here
 * from `/oauth/authorize` with a signed `request` the server issued; this
 * page only shows what it says and posts the answer back.
 *
 * REST (`/api/oauth/consent`), not GraphQL: like login, this is an auth seam,
 * and its answer is a browser redirect to the agent rather than data to cache.
 * The server re-reads every OAuth parameter from the signed request, so
 * nothing on this page can change who gets access or where they are sent.
 *
 * Behind `ProtectedRoute`: a signed-out reader signs in and lands back here.
 */
export const OAuthConsentPage = () => {
  const styles = useStyle();
  const showToast = useToast();
  const [searchParams] = useSearchParams();
  const request = searchParams.get('request') ?? '';
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [answering, setAnswering] = useState<'allow' | 'deny' | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await apiFetch(
          `/api/oauth/consent?request=${encodeURIComponent(request)}`
        );
        const next: LoadState = response.ok
          ? { status: 'ready', details: (await response.json()) as ConsentDetails }
          : {
              status: 'error',
              message: await errorMessage(response, 'This sign-in request could not be loaded.'),
            };
        if (!cancelled) setState(next);
      } catch {
        if (!cancelled) {
          setState({ status: 'error', message: 'Network error — please reload the page.' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [request]);

  const answer = useCallback(
    async (approve: boolean) => {
      setAnswering(approve ? 'allow' : 'deny');
      try {
        const response = await apiFetch('/api/oauth/consent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ request, approve }),
        });
        if (!response.ok) {
          showToast(await errorMessage(response, 'Could not send your answer'), 'error');
          setAnswering(null);
          return;
        }
        const { redirectTo } = (await response.json()) as { redirectTo: string };
        // Back to the agent, carrying the code (or the refusal). Not a router
        // navigation: the destination is the agent's own address.
        window.location.assign(redirectTo);
      } catch {
        showToast('Network error — please try again', 'error');
        setAnswering(null);
      }
    },
    [request, showToast]
  );

  return (
    <Page type="minimal">
      <div className={styles.root}>
        <BrandLockup />
        <div className={styles.stack}>
          <Card>
            <div className={styles.content}>
              {state.status === 'loading' && <p className={styles.text}>Loading…</p>}
              {state.status === 'error' && (
                <p className={styles.text} role="alert">
                  {state.message}
                </p>
              )}
              {state.status === 'ready' && (
                <>
                  <h1 className={styles.title}>
                    Connect {state.details.clientName} to {state.details.libraryName}?
                  </h1>
                  <p className={styles.text}>
                    <strong>{state.details.clientName}</strong> is asking to use your library as{' '}
                    <strong>{state.details.username}</strong>. If you allow it, it will be able to:
                  </p>
                  <ul className={styles.list}>
                    <li>search your library and read book and series details</li>
                    <li>edit book metadata and covers, and validate books</li>
                    <li>download, add and replace books</li>
                    <li>request books from the library admin</li>
                  </ul>
                  <p className={styles.text}>
                    You will be returned to <strong>{state.details.redirectHost}</strong>. You can
                    disconnect it at any time from Settings.
                  </p>
                  <div className={styles.actions}>
                    <Button
                      type="primary"
                      radius="card"
                      loading={answering === 'allow'}
                      disabled={answering !== null}
                      onClick={() => void answer(true)}
                    >
                      Allow
                    </Button>
                    <Button
                      type="default"
                      radius="card"
                      loading={answering === 'deny'}
                      disabled={answering !== null}
                      onClick={() => void answer(false)}
                    >
                      Deny
                    </Button>
                  </div>
                </>
              )}
            </div>
          </Card>
        </div>
      </div>
    </Page>
  );
};
