import { useMutation, useQuery } from '@apollo/client/react';
import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';

import { BrandLockup, Card, CardDivider, Page } from '~/component';
import { Button, Switch } from '~/control';
import type { McpAuthorizeMutation } from '~/gql/graphql';
import { McpAuthorizeDocument, McpClientDocument } from '~/graphql/mcp';
import { CheckIcon, XIcon } from '~/icon';
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

/**
 * One line per capability, so the reader can see exactly what the assistant
 * gets. Every line is ALWAYS rendered: with Read only on, the write lines
 * stay in place but are marked as not granted, so the card never changes
 * height as the switch flips.
 */
const PERMISSIONS: ReadonlyArray<{ text: string; write: boolean }> = [
  { text: 'Search your library', write: false },
  { text: 'Read book and series details', write: false },
  { text: 'Edit book metadata', write: true },
  { text: 'Run validation', write: true },
  { text: 'Upload and replace books', write: true },
  { text: 'Act on metadata recommendations', write: true },
  { text: 'Request and delete books', write: true },
];

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
          is asking to access your Bookplate library.
        </p>
        <CardDivider />
        <Switch
          name="read-only"
          label="Read only"
          layout="horizontal"
          checked={readOnly}
          onChange={setReadOnly}
        />
        <ul className={styles.details}>
          {PERMISSIONS.map(({ text, write }) => {
            const granted = !write || showWrite;
            const Icon = granted ? CheckIcon : XIcon;
            return (
              <li
                key={text}
                className={granted ? styles.detail : styles.detailDenied}
                data-granted={granted}
              >
                <Icon width={14} height={14} className={styles.check} aria-hidden />
                <span>{text}</span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  // Approve and Deny live in the card footer, and only once there is
  // something to decide on — the invalid and admin cards have no actions.
  const footer =
    request !== null && !isAdmin && !loading && client !== null ? (
      <>
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
      </>
    ) : undefined;

  return (
    <Page type="minimal">
      <div className={styles.root}>
        <BrandLockup />
        <div className={styles.stack}>
          <Card footer={footer}>
            <div className={styles.content}>{body}</div>
          </Card>
        </div>
      </div>
    </Page>
  );
};
