import { useQuery } from '@apollo/client/react';
import type { MockedResponse } from '@apollo/client/testing';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { LibrarySubjectsQuery } from '~/gql/graphql';
import { LibrarySubjectsDocument } from '~/graphql/library';
import { PULL_THRESHOLD } from '~/lib/use-pull-to-refresh';
import { renderWithApollo } from '~/test-utils';

import { PullToRefresh } from '.';

/**
 * `LibrarySubjectsDocument` as the stand-in for "a query some screen has
 * mounted" — the same fixture `lib/use-prefetch-on-intent.test.tsx` uses, for
 * the same reason: the simplest single-variable document in the codebase, and
 * codegen ignores `*.test.tsx`, so reusing it adds nothing for the cost
 * tooling to count.
 */
const LIBRARY_ID = 'LIB-1';

const subjectsMock = (subjects: string[], delay = 0): MockedResponse<LibrarySubjectsQuery> => ({
  request: { query: LibrarySubjectsDocument, variables: { libraryId: LIBRARY_ID } },
  delay,
  result: {
    data: {
      __typename: 'Query',
      node: { __typename: 'Library', id: LIBRARY_ID, subjects },
    },
  },
});

// A screen with one active query, exactly as a page would have.
const Subjects = () => {
  const { data } = useQuery(LibrarySubjectsDocument, { variables: { libraryId: LIBRARY_ID } });
  const library = data?.node?.__typename === 'Library' ? data.node : null;
  return <p>{library ? library.subjects.join(', ') : 'loading'}</p>;
};

// A finger landing at the top of the page and pulling it well past the
// threshold, then letting go. The pull is the scroller's rubber-band, which
// iOS reports as a negative scroll position while it lasts.
const pullToRefresh = () => {
  fireEvent.touchStart(document.body, { touches: [{ clientX: 100, clientY: 100 }] });
  Object.defineProperty(window, 'scrollY', {
    value: -(PULL_THRESHOLD + 20),
    writable: true,
    configurable: true,
  });
  const move = new TouchEvent('touchmove', { bubbles: true, cancelable: true });
  Object.defineProperty(move, 'touches', {
    value: [{ clientX: 100, clientY: 100 + PULL_THRESHOLD * 4 }],
  });
  document.body.dispatchEvent(move);
  fireEvent.touchEnd(document.body, { touches: [] });
  Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });
};

afterEach(() => {
  Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });
});

describe('PullToRefresh', () => {
  it('refetches the queries active on the screen when pulled past the threshold and released', async () => {
    renderWithApollo(
      <>
        <PullToRefresh />
        <Subjects />
      </>,
      { mocks: [subjectsMock(['sci-fi']), subjectsMock(['sci-fi', 'fantasy'])] }
    );
    await screen.findByText('sci-fi');

    act(() => {
      pullToRefresh();
    });

    // The second mock is only ever reached by a network refetch; the cache
    // already holds the first answer, so nothing else would ask again.
    await screen.findByText('sci-fi, fantasy');
  });

  it('announces the refresh while it is in flight, and only then', async () => {
    renderWithApollo(
      <>
        <PullToRefresh />
        <Subjects />
      </>,
      { mocks: [subjectsMock(['sci-fi']), subjectsMock(['sci-fi', 'fantasy'], 50)] }
    );
    await screen.findByText('sci-fi');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    act(() => {
      pullToRefresh();
    });

    expect(screen.getByRole('status', { name: 'Refreshing' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.getByText('sci-fi, fantasy')).toBeInTheDocument();
  });
});
