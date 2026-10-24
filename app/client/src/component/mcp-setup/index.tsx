import { useQuery } from '@apollo/client/react';

import { Card } from '~/component';
import { UrlRow } from '~/component/connection-urls';
import { McpStatusDocument } from '~/graphql/mcp';

import { useStyle } from './style';

/**
 * The ADMIN's view of MCP on `page/settings`: whether the install publishes
 * an MCP server and, if not, what to change. Readers cannot set `public_url`,
 * so their own "AI assistants" card (`component/mcp-connections`) simply
 * stays hidden until this is done; the explanation lives here, with the one
 * person who can act on it.
 *
 * Its own small query rather than a field on the route document: the admin
 * branch of `page/settings` sends no `UserPageDocument` (it is skipped for
 * admins to spare the `Viewer.devices` cost), and these two scalars are not
 * worth adding to the app-wide bootstrap read every viewer makes.
 */
export const McpSetup = () => {
  const style = useStyle();
  const { data } = useQuery(McpStatusDocument);
  if (data === undefined) return null;
  const { mcpEnabled, mcpUrl } = data.viewer;

  return (
    <Card title="AI assistants">
      <div className={style.stack}>
        <p className={style.lead}>
          Readers can connect Claude or another MCP assistant to their own library — to search it,
          fix metadata, run validation and add books — and manage those connections from their
          Settings page.
        </p>
        {mcpEnabled && mcpUrl !== null ? (
          <>
            <p className={style.status}>
              <span className={style.statusOn}>Enabled.</span> Readers add this URL to their
              assistant as a custom connector:
            </p>
            <UrlRow url={mcpUrl} />
          </>
        ) : (
          <>
            <p className={style.status}>
              <span className={style.statusOff}>Not enabled.</span> The connection flow needs a
              stable, secure address to publish, and readers will not see the option until it has
              one.
            </p>
            <ol className={style.steps}>
              <li>
                In the add-on&rsquo;s <strong>Configuration tab</strong>, set{' '}
                <code className={style.code}>public_url</code> to the <strong>https</strong> origin
                this Bookplate is reached at — for example your reverse proxy, Cloudflare Tunnel or
                Nabu Casa address, such as{' '}
                <code className={style.code}>https://bookplate.example.com</code>.
              </li>
              <li>
                Restart the add-on. This card will then show the URL readers paste into their
                assistant.
              </li>
            </ol>
          </>
        )}
      </div>
    </Card>
  );
};
