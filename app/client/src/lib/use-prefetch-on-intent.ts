import type { OperationVariables, TypedDocumentNode } from '@apollo/client';
import { useApolloClient } from '@apollo/client/react';
import { useCallback, useRef } from 'react';

export type UsePrefetchOnIntentOptions = {
  skip?: boolean;
};

export type UsePrefetchOnIntentResult = {
  /** Spread onto the trigger element. */
  intentProps: {
    onMouseEnter: () => void;
    onFocus: () => void;
    onTouchStart: () => void;
  };
  /** Fire immediately — for a trigger with no hover phase. */
  prefetch: () => void;
};

/**
 * The first of the two brakes on this codebase's "a conditionally-rendered
 * subtree gets its own lazy query" default (the design record's own term):
 * fire the query on hover/focus/touch of the TRIGGER, ahead of the click
 * that actually mounts the panel. Apollo dedupes an identical in-flight
 * query (`queryDeduplication`, on by default), so the panel's own real
 * `useQuery` — issued a beat later, once the click actually lands — usually
 * finds the data already arriving, or already cached. Built once here;
 * Task 7 onward is the first of this primitive's call sites, not this task.
 *
 * Implemented directly over `client.query({ fetchPolicy: 'cache-first' })`
 * rather than a second `useQuery`: a prefetch has no component of its own to
 * re-render, doesn't want to hold `loading`/`error` state, and must be
 * callable from an event handler rather than mounted unconditionally the way
 * `useQuery` requires. `cache-first` means a trigger re-hovered after its
 * panel already loaded the same variables costs nothing further — Apollo
 * answers from the cache without a network round trip.
 *
 * **"Fresh" is defined as "already fired for this exact variables identity,
 * ever, for the lifetime of this hook instance."** No timer, no expiry: once
 * a `(document, variables)` pair has been prefetched, this hook does not
 * re-issue it again on a later hover, no matter how much later. Two things
 * make that the right amount of simple rather than a shortcut: (1) the
 * whole point of this guard is to stop a mouse SWEEP — many `onMouseEnter`/
 * `onFocus` events over a handful of milliseconds — from becoming a request
 * per pixel, not to model cache staleness (Apollo's own cache policies,
 * refetches, and invalidation already own that once the panel's real
 * `useQuery` is mounted); (2) a variables CHANGE (a different book id, a
 * different filter) always clears the guard immediately, since it is keyed
 * on the variables themselves — a genuinely new prefetch target is never
 * blocked by an old one's guard.
 *
 * Failures are swallowed deliberately: this call has no UI of its own to
 * report an error through, and the panel's own `useQuery` (mounted on the
 * committed click) surfaces the real error properly once it lands. A
 * rejected background prefetch must never become a browser
 * `unhandledrejection` — the `.catch()` below is attached synchronously, in
 * the same tick `client.query` is called, precisely so there is never a
 * window where the returned promise is unhandled (see this project's Task 1
 * review finding on `void handleX()` with no `.catch`, which is exactly the
 * shape this guards against).
 */
export function usePrefetchOnIntent<TData, TVariables extends OperationVariables>(
  document: TypedDocumentNode<TData, TVariables>,
  variables: TVariables,
  options?: UsePrefetchOnIntentOptions
): UsePrefetchOnIntentResult {
  const skip = options?.skip ?? false;
  const client = useApolloClient();

  // Keyed on the variables' VALUE, not their reference — most call sites
  // pass a fresh object literal per render, so a reference-identity guard
  // would never actually block anything.
  const firedForKey = useRef<string | undefined>(undefined);

  const prefetch = useCallback(() => {
    if (skip) return;

    const key = JSON.stringify(variables);
    if (firedForKey.current === key) return;
    firedForKey.current = key;

    client.query({ query: document, variables, fetchPolicy: 'cache-first' }).catch(() => {
      // Deliberately swallowed — see this hook's own doc comment above.
    });
  }, [skip, client, document, variables]);

  return {
    intentProps: {
      onMouseEnter: prefetch,
      onFocus: prefetch,
      onTouchStart: prefetch,
    },
    prefetch,
  };
}
