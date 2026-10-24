import { useMutation, useQuery } from '@apollo/client/react';
import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';

import { BrandLockup, Card, Page } from '~/component';
import { Button, Switch } from '~/control';
import type { McpAuthorizeMutation } from '~/gql/graphql';
import { McpAuthorizeDocument, McpClientDocument } from '~/graphql/mcp';
import { unwrapResult } from '~/provider/apollo';
import { useIsAdmin } from '~/provider/auth';
import { useToast } from '~/provider/toast';

import { useStyle } from './style';

type McpAuthorizePayload = Extract<
  NonNullable<McpAuthorizeMutation['mcpAuthorize']>,
  { __typename: 'McpAuthorizePayload' }
>;

/**
 * The parameters the server's authorize endpoint forwarded. They are a
 * CLAIM: the mutation re-validates the client and redirect URI before writing
 * a code or sending the browser anywhere, so this page only has to read them.
 */
type ConsentRequest = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
  scope: string | null;
  resource: string | null;
};

const readRequest = (params: URLSearchParams): ConsentRequest | null => {
  const clientId = params.get('client_id');
  const redirectUri = params.get('redirect_uri');
  const codeChallenge = params.get('code_challenge');
  if (!clientId || !redirectUri || !codeChallenge) return null;
  return {
    clientId,
    redirectUri,
    codeChallenge,
    state: params.get('state'),
    scope: params.get('scope'),
    resource: params.get('resource'),
  };
};

/** Whether the client asked for write access (or for nothing, which means everything). */
const wantsWrite = (scope: string | null): boolean =>
  scope === null || scope.trim() === '' || scope.split(' ').includes('library:write');

const INVALID = 'This connection link is invalid.';
const ADMIN = 'The admin account has no library to connect. Sign in as a reader.';

/**
 * The OAuth consent screen for MCP assistants. `ProtectedRoute` has already
 * made sure someone is signed in (and brought them back here, query string
 * intact, after `/login`). Approve and Deny both go through `mcpAuthorize`,
 * which answers with the URL to send the browser to — Deny included, so an
 * unregistered redirect URI can never be followed from this page.
 */
export const ConnectPage = () => {
  const styles = useStyle();
  const showToast = useToast();
  const [isAdmin] = useIsAdmin();
  const [params] = useSearchParams();
  const request = useMemo(() => readRequest(params), [params]);

  const { data, loading } = useQuery(McpClientDocument, {
    variables: { clientId: request?.clientId ?? '' },
    skip: request === null || isAdmin,
  });
  const [authorize] = useMutation(McpAuthorizeDocument);

  const [readOnly, setReadOnly] = useState(false);
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null);

  const decide = useCallback(
    async (approve: boolean) => {
      if (request === null) return;
      setBusy(approve ? 'approve' : 'deny');
      try {
        const { data: result } = await authorize({
          variables: {
            input: {
              clientId: request.clientId,
              redirectUri: request.redirectUri,
              codeChallenge: request.codeChallenge,
              state: request.state,
              scope: request.scope,
              resource: request.resource,
              approve,
              readOnly: approve ? readOnly : false,
            },
          },
        });
        const outcome = unwrapResult<McpAuthorizePayload>(
          result?.mcpAuthorize,
          'McpAuthorizePayload'
        );
        if (outcome.status === 'ok') {
          window.location.assign(outcome.payload.redirectUrl);
          return;
        }
        showToast(
          outcome.status === 'error' ? outcome.message : 'Could not complete the connection',
          'error'
        );
      } catch {
        showToast('Could not complete the connection', 'error');
      } finally {
        setBusy(null);
      }
    },
    [authorize, readOnly, request, showToast]
  );

  const client = data?.mcpClient ?? null;
  const showWrite = wantsWrite(request?.scope ?? null) && !readOnly;

  let body: React.ReactNode;
  if (request === null) {
    body = <p className={styles.lead}>{INVALID}</p>;
  } else if (isAdmin) {
    body = <p className={styles.lead}>{ADMIN}</p>;
  } else if (loading) {
    body = <p className={styles.lead}>Loading…</p>;
  } else if (client === null) {
    body = <p className={styles.lead}>{INVALID}</p>;
  } else {
    body = (
      <div className={styles.form}>
        <h2 className={styles.title}>Connect {client.clientName}?</h2>
        <p className={styles.lead}>
          {client.clientUri !== null ? (
            <a href={client.clientUri} target="_blank" rel="noopener noreferrer">
              {client.clientName}
            </a>
          ) : (
            client.clientName
          )}{' '}
          is asking to use your Bookplate library. It will be able to:
        </p>
        <ul className={styles.bullets}>
          <li>Search your library and read book and series details</li>
          {showWrite && (
            <li>
              Edit metadata, run validation, upload and replace books, and act on recommendations
            </li>
          )}
        </ul>
        <Switch
          name="read-only"
          label="Read only"
          description="Let it look, but not change anything."
          layout="horizontal"
          checked={readOnly}
          onChange={setReadOnly}
        />
        <div className={styles.actions}>
          <Button
            type="default"
            radius="card"
            loading={busy === 'deny'}
            disabled={busy !== null}
            onClick={() => void decide(false)}
          >
            Deny
          </Button>
          <Button
            type="primary"
            radius="card"
            loading={busy === 'approve'}
            disabled={busy !== null}
            onClick={() => void decide(true)}
          >
            Approve
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Page type="minimal">
      <div className={styles.root}>
        <BrandLockup />
        <div className={styles.stack}>
          <Card>
            <div className={styles.content}>{body}</div>
          </Card>
        </div>
      </div>
    </Page>
  );
};
