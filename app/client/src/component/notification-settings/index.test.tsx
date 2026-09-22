import { useQuery } from '@apollo/client/react';
import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { makeFragmentData } from '~/gql';
import type {
  NotificationPreferenceFragmentFragment,
  ViewerBootstrapQuery,
  ViewerSetNotificationPreferenceMutation,
  ViewerSetNotificationPreferenceMutationVariables,
} from '~/gql/graphql';
import {
  NotificationPreferenceFragment,
  ViewerSetNotificationPreferenceDocument,
} from '~/graphql/notification';
import { ViewerBootstrapDocument } from '~/graphql/viewer-bootstrap';
import { renderWithApollo } from '~/test-utils';

import { NotificationSettings } from './index';

/**
 * A typed `NotificationPreferenceFragmentFragment` VARIABLE, never an inline
 * object literal at a call site — same reasoning as
 * `component/device-row/index.test.tsx`'s `device()`: a fresh literal fails
 * TypeScript's excess-property check against `NotificationSettings`'s
 * MASKED `preferences` prop, and `makeFragmentData` is the sanctioned cast
 * back to that masked type.
 */
const preference = (
  overrides: Partial<NotificationPreferenceFragmentFragment> = {}
): NotificationPreferenceFragmentFragment => ({
  __typename: 'NotificationPreference',
  event: overrides.event ?? 'BOOK_REQUEST_FULFILLED',
  channel: overrides.channel ?? 'EMAIL',
  enabled: overrides.enabled ?? true,
});

const preferences = [
  preference({ event: 'BOOK_REQUEST_FULFILLED', enabled: true }),
  preference({ event: 'BOOK_REQUEST_DECLINED', enabled: false }),
].map((row) => makeFragmentData(row, NotificationPreferenceFragment));

const viewerBootstrapMock = (
  notificationPreferences: NotificationPreferenceFragmentFragment[]
): MockedResponse<ViewerBootstrapQuery> => ({
  request: { query: ViewerBootstrapDocument },
  result: {
    data: {
      __typename: 'Query',
      viewer: {
        __typename: 'Viewer',
        username: 'alice',
        isAdmin: false,
        mustChangePassword: false,
        email: 'alice@example.com',
        emailVerifiedAt: '2024-01-01T00:00:00.000Z',
        notificationPreferences,
        user: { __typename: 'User', id: 'USER-1' },
        library: { __typename: 'Library', id: 'LIB-1' },
      },
    },
  },
});

/**
 * Mirrors `page/user`'s own composition: reads `ViewerBootstrapDocument` and
 * passes its `notificationPreferences` straight through as the `preferences`
 * prop, exactly as `page/user/index.tsx`'s `notificationSection` does.
 * `NotificationSettings` itself holds no state of its own for the list — a
 * successful toggle writes the mutation's returned list onto the `Viewer`
 * singleton via `cache.modify`, and THIS harness's `useQuery` is the active
 * watcher that reacts to that write and re-renders with the fresh list, the
 * same mechanism `page/user`'s own `useQuery(ViewerBootstrapDocument)` relies
 * on in the real app. A test that instead fed `NotificationSettings` a fixed
 * `preferences` prop and expected it to update on its own would be testing
 * component-local state this component deliberately does not have.
 */
const Harness = () => {
  const { data } = useQuery(ViewerBootstrapDocument);
  return (
    <NotificationSettings
      preferences={data?.viewer.notificationPreferences ?? []}
      emailVerified={data?.viewer.emailVerifiedAt != null}
    />
  );
};

describe('NotificationSettings', () => {
  it('renders nothing when the catalogue is empty', () => {
    // Not `expect(container).toBeEmptyDOMElement()`: `renderWithApollo`
    // wraps every render in the real provider stack, and `ToastProvider`
    // unconditionally renders its own (empty) toast-portal `<div>` as a
    // sibling of whatever's under test — that div is always in `container`,
    // toasts or not, so asserting on the CARD itself is the accurate check.
    renderWithApollo(<NotificationSettings preferences={[]} emailVerified />);
    expect(screen.queryByText('Notifications')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('renders one labelled control per preference, reflecting its state', () => {
    renderWithApollo(<NotificationSettings preferences={preferences} emailVerified />);

    const fulfilled = screen.getByRole('switch', { name: /added to my library/i });
    const declined = screen.getByRole('switch', { name: /declined/i });
    expect(fulfilled).toBeChecked();
    expect(declined).not.toBeChecked();
  });

  it('disables every control and explains why when the address is unverified', () => {
    renderWithApollo(<NotificationSettings preferences={preferences} emailVerified={false} />);

    // `control/switch` renders a plain `<div role="switch" aria-disabled>`,
    // not a native form control — jest-dom's `toBeDisabled()` only inspects
    // native disablable tags (see its `canElementBeDisabled`), so it never
    // matches here even when the switch is correctly disabled. Asserting
    // the `aria-disabled` attribute directly is the accurate check for this
    // control; `component/device-form`'s own tests hit the same limitation
    // for other non-native controls.
    expect(screen.getByRole('switch', { name: /added to my library/i })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(screen.getByText(/confirm your email address/i)).toBeInTheDocument();
  });

  it("reflects the mutation's returned state once the watching query updates, agreeing with the row's own optimistic value", async () => {
    const initial = [
      preference({ event: 'BOOK_REQUEST_FULFILLED', enabled: true }),
      preference({ event: 'BOOK_REQUEST_DECLINED', enabled: false }),
    ];
    const mocks: [
      MockedResponse<ViewerBootstrapQuery>,
      MockedResponse<
        ViewerSetNotificationPreferenceMutation,
        ViewerSetNotificationPreferenceMutationVariables
      >,
    ] = [
      viewerBootstrapMock(initial),
      {
        request: {
          query: ViewerSetNotificationPreferenceDocument,
          variables: { event: 'BOOK_REQUEST_FULFILLED', channel: 'EMAIL', enabled: false },
        },
        result: {
          data: {
            __typename: 'Mutation',
            viewerSetNotificationPreference: {
              __typename: 'ViewerSetNotificationPreferencePayload',
              notificationPreferences: [
                preference({ event: 'BOOK_REQUEST_FULFILLED', enabled: false }),
                preference({ event: 'BOOK_REQUEST_DECLINED', enabled: false }),
              ],
            },
          },
        },
      },
    ];
    renderWithApollo(<Harness />, { mocks });

    const fulfilled = await screen.findByRole('switch', { name: /added to my library/i });
    expect(fulfilled).toBeChecked();

    await userEvent.click(fulfilled);

    // Not just "the mutation fired": this only passes if `cache.modify`'s
    // write actually lands where `Harness`'s `useQuery(ViewerBootstrapDocument)`
    // reads from, which is the same path `page/user` depends on in the real
    // app — a stale local copy of the LIST inside `NotificationSettings`
    // would make this assertion pass for the wrong reason. (The row's own
    // brief `pending` optimism, covered separately below, already shows this
    // value before the mutation resolves; this test's `waitFor` proves the
    // cache write independently arrives at the same state once it does.)
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: /added to my library/i })).not.toBeChecked();
    });
  });

  it('shows the optimistic value immediately, before the mutation resolves', async () => {
    renderWithApollo(<NotificationSettings preferences={preferences} emailVerified />, {
      mocks: [
        {
          request: {
            query: ViewerSetNotificationPreferenceDocument,
            variables: { event: 'BOOK_REQUEST_FULFILLED', channel: 'EMAIL', enabled: false },
          },
          result: {
            data: {
              __typename: 'Mutation',
              viewerSetNotificationPreference: {
                __typename: 'ViewerSetNotificationPreferencePayload',
                notificationPreferences: [
                  preference({ event: 'BOOK_REQUEST_FULFILLED', enabled: false }),
                  preference({ event: 'BOOK_REQUEST_DECLINED', enabled: false }),
                ],
              },
            },
          },
          delay: 20,
        },
      ],
    });

    const fulfilled = screen.getByRole('switch', { name: /added to my library/i });
    expect(fulfilled).toBeChecked();

    await userEvent.click(fulfilled);

    // The delayed mock has not resolved yet — this only reads true if the
    // click itself (not the eventual mutation response) is what flipped it.
    expect(fulfilled).not.toBeChecked();

    // And it stays that way once the mutation actually lands: the pending
    // value and the fresh state agree, so there is no visible flicker back.
    await waitFor(() => expect(fulfilled).not.toBeChecked());
  });

  it('reverts to the prior value and toasts when the mutation errors', async () => {
    renderWithApollo(<NotificationSettings preferences={preferences} emailVerified />, {
      mocks: [
        {
          request: {
            query: ViewerSetNotificationPreferenceDocument,
            variables: { event: 'BOOK_REQUEST_FULFILLED', channel: 'EMAIL', enabled: false },
          },
          error: new Error('network exploded'),
          delay: 20,
        },
      ],
    });

    const fulfilled = screen.getByRole('switch', { name: /added to my library/i });
    await userEvent.click(fulfilled);

    expect(fulfilled).not.toBeChecked(); // optimistic, ahead of the rejection

    await waitFor(() => expect(fulfilled).toBeChecked()); // reverted once it rejects
    expect(await screen.findByRole('status')).toHaveTextContent('Could not save that preference');
  });

  it('ignores a second click on a row while its own mutation is still in flight', async () => {
    const matcher = vi.fn(() => true);
    renderWithApollo(<NotificationSettings preferences={preferences} emailVerified />, {
      mocks: [
        {
          request: { query: ViewerSetNotificationPreferenceDocument, variables: matcher },
          result: {
            data: {
              __typename: 'Mutation',
              viewerSetNotificationPreference: {
                __typename: 'ViewerSetNotificationPreferencePayload',
                notificationPreferences: [
                  preference({ event: 'BOOK_REQUEST_FULFILLED', enabled: false }),
                  preference({ event: 'BOOK_REQUEST_DECLINED', enabled: false }),
                ],
              },
            },
          },
          delay: 20,
        },
      ],
    });

    const fulfilled = screen.getByRole('switch', { name: /added to my library/i });
    await userEvent.click(fulfilled);
    // A second click while the row's own mutation is still in flight must not
    // fire a second mutation — MockLink only has ONE queued response for this
    // row; the assertion below would also fail closed (never satisfied) if the
    // guard were missing and a second call went out with no mock left for it.
    await userEvent.click(fulfilled);

    await waitFor(() => expect(matcher).toHaveBeenCalledTimes(1));
  });
});
