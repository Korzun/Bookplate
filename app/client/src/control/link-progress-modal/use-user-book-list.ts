import { useEffect, useMemo, useState } from 'react';

import { apiFetch } from '~/lib/api-fetch';
import { useIsAdmin } from '~/provider/auth';
import type { Book } from '~/provider/book';

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; books: Book[] }
  | { status: 'error'; message: string };

export type UseUserBookList =
  | [Book[], false, false, undefined]
  | [Book[], true, false, undefined]
  | [Book[], false, true, undefined]
  | [Book[], false, true, string];

const EMPTY: Book[] = [];

/**
 * Fetches the given user's library directly, scoped to the row user rather than
 * the library switcher target. This modal is reachable both from the admin
 * Users page and from a user's own progress view; the server rejects ?user=
 * from non-admins, so the scope is only appended when the session is admin
 * (non-admins fetch their own library from the bare endpoint).
 */
export const useUserBookList = (username: string, enabled: boolean): UseUserBookList => {
  const [isAdmin] = useIsAdmin();
  const [state, setState] = useState<State>({ status: 'idle' });

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const url = isAdmin ? `/api/books?user=${encodeURIComponent(username)}` : '/api/books';

    void (async () => {
      // All state updates happen after an await, so the effect never updates
      // state synchronously during render.
      await Promise.resolve();
      if (cancelled) return;
      setState({ status: 'loading' });
      try {
        const response = await apiFetch(url);
        if (!response.ok) throw new Error('Failed to load books');
        const bookListArray = (await response.json()) as Book[];
        if (cancelled) return;
        setState({
          status: 'loaded',
          books: [...bookListArray].sort((a, b) => a.title.localeCompare(b.title)),
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAdmin, username, enabled]);

  return useMemo(() => {
    switch (state.status) {
      case 'loaded':
        return [state.books, false, false, undefined];
      case 'error':
        return [EMPTY, false, true, state.message];
      case 'loading':
        return [EMPTY, true, false, undefined];
      default:
        return [EMPTY, false, false, undefined];
    }
  }, [state]);
};
