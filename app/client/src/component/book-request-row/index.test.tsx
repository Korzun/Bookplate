import { useQuery } from '@apollo/client/react';
import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { makeFragmentData } from '~/gql';
import type {
  BookRequestDeclineMutation,
  BookRequestDeclineMutationVariables,
  BookRequestFulfillMutation,
  BookRequestFulfillMutationVariables,
  BookRequestRowFragmentFragment,
  BookRequestStatus,
  LinkPickerBooksQuery,
  LinkPickerBooksQueryVariables,
} from '~/gql/graphql';
import {
  BookRequestDeclineDocument,
  BookRequestFulfillDocument,
  BookRequestRowFragment,
} from '~/graphql/book-request';
import { LinkPickerBooksDocument } from '~/graphql/progress';
import { UserListDocument } from '~/graphql/user';
import type { MetadataFix } from '~/lib/book-types';
import { UploadContext } from '~/provider/upload/context';
import type {
  UploadItem,
  UploadItemStatus,
  UseUploadQueue,
} from '~/provider/upload/hook/use-upload-queue';
import type { AddFileOptions } from '~/provider/upload/hook/use-upload-transport';
import { path } from '~/router';
import { renderWithApollo } from '~/test-utils';

import { BookRequestRow } from './index';

/**
 * A typed `BookRequestRowFragmentFragment` VARIABLE, never an inline object
 * literal at a call site — mirrors `component/user-row/index.test.tsx`'s
 * `user()` helper: a fresh literal fails TypeScript's excess-property check
 * against `BookRequestRow`'s MASKED `request` prop, and `makeFragmentData`
 * is the sanctioned cast back to that masked type.
 */
const requestRow = (
  overrides: Partial<{
    id: string;
    title: string;
    author: string;
    note: string;
    status: BookRequestStatus;
    declineReason: string;
    book: { id: string; title: string } | null;
  }> = {}
): BookRequestRowFragmentFragment => ({
  __typename: 'BookRequest',
  id: overrides.id ?? 'req-1',
  title: overrides.title ?? 'Dune',
  author: overrides.author ?? 'Frank Herbert',
  note: overrides.note ?? '',
  status: overrides.status ?? 'PENDING',
  declineReason: overrides.declineReason ?? '',
  createdAt: '2026-01-01T00:00:00.000Z',
  resolvedAt: null,
  book:
    overrides.book !== undefined
      ? overrides.book && { __typename: 'Book', ...overrides.book }
      : null,
});

const epubFile = (name: string) => new File(['x'.repeat(1000)], name);

// `LinkExistingBookModal` and `ConfirmModal` are both `<dialog>`-backed
// (`control/use-modal-dialog`) — jsdom has no real `<dialog>` implementation,
// same stub `link-progress-modal/index.test.tsx` installs.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

/** The default no-op queue, matching `~/provider/upload/context.ts`'s own
 * default context value — every field a real `UseUploadQueue` returns. */
const queueValue = (items: UploadItem[], addFiles: UseUploadQueue['addFiles']): UseUploadQueue => ({
  items,
  addFiles,
  applyFix: async () => false,
  applyAllProposals: async () => false,
  dismissAllProposals: async () => false,
  dismissFix: async () => false,
  undo: async () => false,
  dismissCompleted: () => {},
});

type QueueItemOverride = {
  status: UploadItemStatus;
  bookGlobalId?: string;
  fileName?: string;
  errorMessage?: string;
  /** Loosely typed here — these tests only ever assert on `.length`, and the
   * brief's own fixture (`[{}, {}, {}]`) carries no real `MetadataFix`
   * fields. */
  proposals?: unknown[];
};

/** Renders a live `UserListDocument` watcher so `client.refetchQueries`
 * (only ever refetching ACTIVE queries) has something to refetch — same
 * requirement `book-requests-content`'s own refetch tests solve by mounting
 * `MyBookRequestListDocument` twice, except that document is not something
 * `BookRequestRow` itself queries, so this test file needs a standalone
 * watcher sibling instead. */
const UserListWatcher = () => {
  useQuery(UserListDocument);
  return null;
};

const renderRow = (
  overrides: Parameters<typeof requestRow>[0] = {},
  props: {
    canResolve?: boolean;
    onDelete?: (id: string) => void;
    libraryId?: string;
    username?: string;
    queueItem?: QueueItemOverride;
    queueItems?: QueueItemOverride[];
    /** Documents the scenario (auto-fulfil failed to close the request) —
     * the row itself derives "didn't close" purely from `queueItem.status`
     * and `request.status`, so this flag has no effect on the mocks below;
     * it exists only so this test's intent reads clearly at the call site. */
    fulfillFailed?: boolean;
    /** Mounts `UserListWatcher` alongside the row and queues a counting
     * `UserListDocument` mock — opt-in, only the refetch-assertion tests
     * (finding 1 of the final review) need it. */
    watchUserList?: boolean;
  } = {}
) => {
  const onDelete = props.onDelete ?? vi.fn();
  const request = requestRow(overrides);

  const addFilesCallsArr: { files: FileList; options?: AddFileOptions }[] = [];
  const addFiles = (files: FileList, options?: AddFileOptions) => {
    addFilesCallsArr.push({ files, options });
  };

  const fulfillCallsArr: { id: string; bookId: string }[] = [];
  const declineCallsArr: { id: string; reason?: string }[] = [];
  let userListCallCount = 0;

  const mocks: MockedResponse[] = [
    {
      request: {
        query: BookRequestFulfillDocument,
        variables: (vars: BookRequestFulfillMutationVariables) => {
          fulfillCallsArr.push({ id: String(vars.id), bookId: String(vars.bookId) });
          return true;
        },
      },
      result: {
        data: {
          __typename: 'Mutation',
          bookRequestFulfill: {
            __typename: 'BookRequestFulfillPayload',
            bookRequest: {
              __typename: 'BookRequest',
              id: request.id,
              status: 'FULFILLED',
              resolvedAt: '2026-01-02T00:00:00.000Z',
              book: { __typename: 'Book', id: 'Qm9vazox', title: 'Dune' },
            },
          },
        },
      } satisfies { data: BookRequestFulfillMutation },
    },
    {
      request: {
        query: BookRequestDeclineDocument,
        variables: (vars: BookRequestDeclineMutationVariables) => {
          declineCallsArr.push({ id: String(vars.id), reason: vars.reason ?? undefined });
          return true;
        },
      },
      result: {
        data: {
          __typename: 'Mutation',
          bookRequestDecline: {
            __typename: 'BookRequestDeclinePayload',
            bookRequest: { ...requestRow({ ...overrides, status: 'DECLINED' }), id: request.id },
          },
        },
      } satisfies { data: BookRequestDeclineMutation },
    },
  ];

  if (props.watchUserList) {
    mocks.push({
      request: {
        query: UserListDocument,
        variables: () => {
          userListCallCount += 1;
          return true;
        },
      },
      maxUsageCount: Number.POSITIVE_INFINITY,
      result: { data: { __typename: 'Query', viewer: { __typename: 'Viewer', users: [] } } },
    });
  }

  if (props.libraryId !== undefined) {
    mocks.push({
      request: {
        query: LinkPickerBooksDocument,
        variables: { libraryId: props.libraryId, query: undefined },
      },
      result: {
        data: {
          __typename: 'Query',
          node: {
            __typename: 'Library',
            id: props.libraryId,
            entries: {
              __typename: 'LibraryEntriesConnection',
              edges: [
                {
                  __typename: 'LibraryEntriesConnectionEdge',
                  cursor: 'book-1',
                  node: {
                    __typename: 'Book',
                    id: 'Qm9vazox',
                    title: 'Dune',
                    author: 'Frank Herbert',
                  },
                },
              ],
              pageInfo: { __typename: 'PageInfo', hasNextPage: false, endCursor: null },
            },
          },
        },
      } satisfies { data: LinkPickerBooksQuery },
    } satisfies MockedResponse<LinkPickerBooksQuery, LinkPickerBooksQueryVariables>);
  }

  const target =
    props.libraryId !== undefined || props.username !== undefined
      ? { libraryId: props.libraryId ?? 'lib-default', username: props.username ?? 'reader' }
      : undefined;

  const overrideList = props.queueItems ?? (props.queueItem ? [props.queueItem] : []);
  const items: UploadItem[] = overrideList.map((queueItem, index) => ({
    id: `item-${index + 1}`,
    fileName: queueItem.fileName ?? 'dune.epub',
    fileSize: 1000,
    bytesUploaded: 1000,
    fulfillsRequestId: request.id,
    status: queueItem.status,
    bookGlobalId: queueItem.bookGlobalId,
    errorMessage: queueItem.errorMessage,
    proposals: queueItem.proposals as MetadataFix[] | undefined,
  }));

  const rendered = renderWithApollo(
    <UploadContext.Provider value={queueValue(items, addFiles)}>
      {props.watchUserList && <UserListWatcher />}
      <BookRequestRow
        request={makeFragmentData(request, BookRequestRowFragment)}
        canResolve={props.canResolve ?? false}
        onDelete={onDelete}
        target={target}
      />
    </UploadContext.Provider>,
    { mocks }
  );

  return {
    ...rendered,
    user: userEvent.setup(),
    onDelete,
    addFilesCalls: () => addFilesCallsArr,
    fulfillCalls: () => fulfillCallsArr,
    userListCalls: () => userListCallCount,
    declineCalls: () => declineCallsArr,
  };
};

describe('BookRequestRow', () => {
  it('shows title, author and a pending state', () => {
    renderRow({ status: 'PENDING', title: 'Dune', author: 'Frank Herbert' });
    expect(screen.getByText('Dune')).toBeInTheDocument();
    expect(screen.getByText(/Frank Herbert/)).toBeInTheDocument();
    expect(screen.getByText(/Pending/i)).toBeInTheDocument();
  });

  it('links to the book once fulfilled, through path.book (not a hand-rolled /book/<id>)', () => {
    // The id below carries `+` and `/` — legal bytes in a base64 Relay
    // global id — specifically so this test can tell a correctly-encoded
    // `path.book(id)` href apart from a naively-templated one: an
    // un-encoded `/book/${id}` would produce a DIFFERENT (and broken) path
    // segment for this id, not just a differently-prefixed one.
    const bookId = 'Qm9vaz+ox/1==';
    renderRow({ status: 'FULFILLED', book: { id: bookId, title: 'Dune' } });
    expect(screen.getByRole('link', { name: /Dune/ })).toHaveAttribute('href', path.book(bookId));
  });

  it('says the book was added even when the link is gone', () => {
    renderRow({ status: 'FULFILLED', book: null });
    expect(screen.getByText(/added to your library/i)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows the decline reason when there is one', () => {
    renderRow({ status: 'DECLINED', declineReason: "Couldn't find a copy" });
    expect(screen.getByText(/Couldn't find a copy/)).toBeInTheDocument();
  });

  it('offers no resolve actions when canResolve is false', () => {
    renderRow({ status: 'PENDING' }, { canResolve: false });
    expect(screen.queryByRole('button', { name: /decline/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /link existing book/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/upload epub/i)).not.toBeInTheDocument();
  });

  it('calls onDelete with the row id, labelled Withdraw while pending', async () => {
    const onDelete = vi.fn();
    renderRow({ status: 'PENDING', id: 'req-42' }, { onDelete });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /withdraw/i }));

    expect(onDelete).toHaveBeenCalledWith('req-42');
  });

  it('labels the delete control Clear once resolved', () => {
    renderRow({ status: 'FULFILLED', book: null });
    expect(screen.getByRole('button', { name: /^clear$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /withdraw/i })).not.toBeInTheDocument();
  });
});

describe('BookRequestRow resolve actions', () => {
  it('offers upload, link and decline when canResolve is true and the request is pending', () => {
    renderRow(
      { id: 'QmVxOjE=', status: 'PENDING' },
      { canResolve: true, libraryId: 'TGliOmJvYg==' }
    );

    expect(screen.getByLabelText(/upload epub/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /link existing book/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /decline/i })).toBeInTheDocument();
  });

  it('queues an upload against this reader library and this request', async () => {
    const { user, addFilesCalls } = renderRow(
      { id: 'QmVxOjE=', status: 'PENDING' },
      { canResolve: true, libraryId: 'TGliOmJvYg==', username: 'bob' }
    );

    await user.upload(screen.getByLabelText(/upload epub/i), epubFile('dune.epub'));

    expect(addFilesCalls()).toHaveLength(1);
    expect(addFilesCalls()[0].options).toEqual({
      target: { libraryId: 'TGliOmJvYg==', username: 'bob' },
      fulfillsRequestId: 'QmVxOjE=',
    });
  });

  it('shows the suggestion count and points at Upload, with no fix review here', async () => {
    renderRow(
      { id: 'QmVxOjE=', status: 'PENDING' },
      {
        canResolve: true,
        queueItem: { status: 'done', bookGlobalId: 'Qm9vazox', proposals: [{}, {}, {}] },
      }
    );

    expect(await screen.findByText(/3 suggestions/i)).toBeInTheDocument();
    expect(screen.getByText(/review in upload/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /apply/i })).not.toBeInTheDocument();
  });

  it('says the upload landed but the request did not close', async () => {
    renderRow(
      { id: 'QmVxOjE=', status: 'PENDING' },
      {
        canResolve: true,
        queueItem: { status: 'done', bookGlobalId: 'Qm9vazox' },
        fulfillFailed: true,
      }
    );

    expect(await screen.findByText(/didn't close/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /link existing book/i })).toBeInTheDocument();
  });

  it('fulfils from the picker', async () => {
    const { user, fulfillCalls } = renderRow(
      { id: 'QmVxOjE=', status: 'PENDING' },
      { canResolve: true, libraryId: 'TGliOmJvYg==' }
    );

    await user.click(screen.getByRole('button', { name: /link existing book/i }));
    await user.click(await screen.findByRole('button', { name: /Dune/ }));

    await waitFor(() => expect(fulfillCalls()).toHaveLength(1));
    expect(fulfillCalls()[0]).toEqual({ id: 'QmVxOjE=', bookId: 'Qm9vazox' });
  });

  // Finding 1 of the final review: `pendingBookRequestCount` is a
  // server-computed `t.relationCount` with no client-visible decrement, so
  // fulfilling from the picker has to refetch `UserListDocument` itself —
  // exactly `user-request-list`'s own `handleDelete` pattern — or the "N
  // pending" badge on the admin's user card reads stale after the row
  // already shows Fulfilled.
  it('refetches UserListDocument after fulfilling from the picker', async () => {
    const { user, fulfillCalls, userListCalls } = renderRow(
      { id: 'QmVxOjE=', status: 'PENDING' },
      { canResolve: true, libraryId: 'TGliOmJvYg==', watchUserList: true }
    );

    await user.click(screen.getByRole('button', { name: /link existing book/i }));
    await user.click(await screen.findByRole('button', { name: /Dune/ }));
    await waitFor(() => expect(fulfillCalls()).toHaveLength(1));

    // One for `UserListWatcher`'s own initial mount, one for the refetch.
    await waitFor(() => expect(userListCalls()).toBe(2));
  });

  it('declines with a reason', async () => {
    const { user, declineCalls } = renderRow(
      { id: 'QmVxOjE=', status: 'PENDING' },
      { canResolve: true }
    );

    await user.click(screen.getByRole('button', { name: /decline/i }));
    await user.type(screen.getByLabelText(/reason/i), "Couldn't find a copy");
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(declineCalls()).toHaveLength(1));
    expect(declineCalls()[0]).toEqual({ id: 'QmVxOjE=', reason: "Couldn't find a copy" });
  });

  // Same finding as the picker test above, for the decline path.
  it('refetches UserListDocument after confirming a decline', async () => {
    const { user, declineCalls, userListCalls } = renderRow(
      { id: 'QmVxOjE=', status: 'PENDING' },
      { canResolve: true, watchUserList: true }
    );

    await user.click(screen.getByRole('button', { name: /decline/i }));
    await user.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(declineCalls()).toHaveLength(1));

    await waitFor(() => expect(userListCalls()).toBe(2));
  });

  it('shows an upload error on the row', async () => {
    renderRow(
      { id: 'QmVxOjE=', status: 'PENDING' },
      { canResolve: true, queueItem: { status: 'error', errorMessage: 'Not an EPUB' } }
    );
    expect(await screen.findByText('Not an EPUB')).toBeInTheDocument();
  });

  // Finding 2 of the final review: `addFiles` APPENDS to the transport's item
  // list, so a failed upload followed by a retry leaves BOTH items in
  // `items`, both carrying this row's `fulfillsRequestId`. `items.find` would
  // keep rendering the FIRST (failed) attempt forever, even once the SECOND
  // attempt lands — this pins `findLast` instead.
  it('tracks the most recent attempt after a retry, not the first failed one', () => {
    renderRow(
      { id: 'QmVxOjE=', status: 'PENDING' },
      {
        canResolve: true,
        queueItems: [
          { status: 'error', errorMessage: 'Not an EPUB' },
          { status: 'done', bookGlobalId: 'Qm9vazox', fileName: 'dune-retry.epub' },
        ],
      }
    );

    expect(screen.queryByText('Not an EPUB')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /dune-retry\.epub/ })).toBeInTheDocument();
  });
});
