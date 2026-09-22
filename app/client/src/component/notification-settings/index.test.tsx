import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { makeFragmentData } from '~/gql';
import type {
  NotificationPreferenceFragmentFragment,
  ViewerSetNotificationPreferenceMutation,
  ViewerSetNotificationPreferenceMutationVariables,
} from '~/gql/graphql';
import {
  NotificationPreferenceFragment,
  ViewerSetNotificationPreferenceDocument,
} from '~/graphql/notification';
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

  it('sends the mutation when a toggle is flipped', async () => {
    const mocks: MockedResponse<
      ViewerSetNotificationPreferenceMutation,
      ViewerSetNotificationPreferenceMutationVariables
    >[] = [
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
    renderWithApollo(<NotificationSettings preferences={preferences} emailVerified />, { mocks });

    await userEvent.click(screen.getByRole('switch', { name: /added to my library/i }));

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: /added to my library/i })).not.toBeChecked();
    });
  });
});
