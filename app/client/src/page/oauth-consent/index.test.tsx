import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { OAuthConsentPage } from './index';

const details = {
  clientName: 'Claude',
  clientUri: null,
  redirectHost: 'claude.ai',
  username: 'alice',
  libraryName: 'Bookplate',
};

const response = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: () => Promise.resolve(body) }) as Response;

let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign, origin: window.location.origin });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const renderPage = () =>
  renderWithProviders(<OAuthConsentPage />, {
    initialEntries: ['/oauth/consent?request=signed.request.jwt'],
  });

describe('OAuthConsentPage', () => {
  it('says who is asking, as whom, and where the reader will be sent', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, details));
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    expect(await screen.findByText('Connect Claude to Bookplate?')).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText('claude.ai')).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/oauth/consent?request=signed.request.jwt');
  });

  it.each([
    ['Allow', true],
    ['Deny', false],
  ])('%s posts the answer and returns the browser to the agent', async (button, approve) => {
    const redirectTo = 'https://claude.ai/api/mcp/auth_callback?code=abc&state=xyz';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200, details))
      .mockResolvedValueOnce(response(200, { redirectTo }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: button }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith(redirectTo));
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('/api/oauth/consent');
    expect(JSON.parse(init.body as string)).toEqual({ request: 'signed.request.jwt', approve });
  });

  it("shows the server's reason when the request cannot be used", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response(403, {
          error: 'The admin account has no library to connect. Sign in as a reader instead.',
        })
      )
    );
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(/admin account has no library/);
    expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument();
  });
});
