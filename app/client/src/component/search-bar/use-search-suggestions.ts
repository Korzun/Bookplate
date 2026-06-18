import { useEffect, useRef, useState } from 'react';

import { apiFetch } from '~/lib/api-fetch';
import type { BookListFilter } from '~/provider/book';
import { useWithTargetUser } from '~/provider/library-target';

export type Suggestion = {
  type: 'entryType' | 'status' | 'author' | 'series' | 'book' | 'subject';
  label: string;
  value: string;
  additive: boolean;
  matchStart: number;
  matchLength: number;
};

export type SuggestionGroup = {
  type: Suggestion['type'];
  label: string;
  items: Suggestion[];
};

type ServerItem = { label: string; value: string; matchStart: number; matchLength: number };
type ServerGroup = {
  type: 'author' | 'series' | 'book' | 'subject';
  items: ServerItem[];
};

const TYPE_OPTIONS: { label: string; value: 'series' | 'standalone' }[] = [
  { label: 'Series', value: 'series' },
  { label: 'Single books', value: 'standalone' },
];

const STATUS_OPTIONS: { label: string; value: string }[] = [
  { label: 'Not Started', value: 'not-started' },
  { label: 'In Progress', value: 'in-progress' },
  { label: 'Completed', value: 'completed' },
];

const GROUP_LABEL: Record<Suggestion['type'], string> = {
  entryType: 'Type',
  status: 'Status',
  author: 'Author',
  series: 'Series',
  book: 'Book',
  subject: 'Subject',
};

function matchInfo(
  text: string,
  query: string
): { matchStart: number; matchLength: number } | null {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return null;
  return { matchStart: idx, matchLength: query.length };
}

export function useSearchSuggestions(
  inputValue: string,
  filter: BookListFilter
): { groups: SuggestionGroup[]; loading: boolean } {
  const withTargetUser = useWithTargetUser();
  const [groups, setGroups] = useState<SuggestionGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Destructure filter fields as primitive deps so the effect does not re-fire
  // when the caller passes a new object literal with identical values.
  const { status, author, seriesName, subjects, entryType } = filter;
  // subjects is a string[] — serialize it so the dep compares by value rather
  // than reference. The effect reconstructs the array from this key.
  const subjectsKey = subjects?.join('\0') ?? '';

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const query = inputValue.trim();
    if (!query) {
      // Abort any in-flight request. Groups and loading are short-circuited at
      // the return site when query is empty, avoiding setState in an effect body
      // (react-hooks/set-state-in-effect).
      abortRef.current?.abort();
      return;
    }

    debounceRef.current = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // Reconstruct subjects array from the serialized key so no array
      // reference is needed in the dep list.
      const subjectsArray = subjectsKey ? subjectsKey.split('\0') : [];

      const params = new URLSearchParams({ q: query });
      if (author) params.set('author', author);
      if (seriesName) params.set('seriesName', seriesName);
      for (const s of subjectsArray) params.append('subjects', s);
      const url = withTargetUser(`/api/search/suggestions?${params.toString()}`);

      setLoading(true);
      apiFetch(url, { signal: controller.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error('Suggestion fetch failed');
          return res.json() as Promise<{ groups: ServerGroup[] }>;
        })
        .then(({ groups: serverGroups }) => {
          if (controller.signal.aborted) return;

          const result: SuggestionGroup[] = [];

          if (!status) {
            const items: Suggestion[] = [];
            for (const opt of STATUS_OPTIONS) {
              const info = matchInfo(opt.label, query);
              if (info) {
                items.push({
                  type: 'status',
                  label: opt.label,
                  value: opt.value,
                  additive: false,
                  ...info,
                });
              }
            }
            if (items.length > 0) result.push({ type: 'status', label: GROUP_LABEL.status, items });
          }

          for (const g of serverGroups) {
            const additive = g.type === 'subject';
            const items: Suggestion[] = g.items.map((item) => ({
              type: g.type,
              label: item.label,
              value: item.value,
              additive,
              matchStart: item.matchStart,
              matchLength: item.matchLength,
            }));
            if (items.length > 0) {
              result.push({ type: g.type, label: GROUP_LABEL[g.type], items });
            }
          }

          setGroups(result);
          setLoading(false);
        })
        .catch((_err: unknown) => {
          if (controller.signal.aborted) return;
          setGroups([]);
          setLoading(false);
        });
    }, 200);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [inputValue, status, author, seriesName, subjectsKey, withTargetUser]);

  // When input is empty, return static quick-pick groups (Type and/or Status)
  // so the dropdown shows useful options on focus. Both are omitted when the
  // corresponding filter is already active.
  const query = inputValue.trim();
  if (!query) {
    const emptyGroups: SuggestionGroup[] = [];
    if (!entryType) {
      emptyGroups.push({
        type: 'entryType',
        label: GROUP_LABEL.entryType,
        items: TYPE_OPTIONS.map((opt) => ({
          type: 'entryType' as const,
          label: opt.label,
          value: opt.value,
          additive: false,
          matchStart: 0,
          matchLength: 0,
        })),
      });
    }
    if (!status) {
      emptyGroups.push({
        type: 'status',
        label: GROUP_LABEL.status,
        items: STATUS_OPTIONS.map((opt) => ({
          type: 'status' as const,
          label: opt.label,
          value: opt.value,
          additive: false,
          matchStart: 0,
          matchLength: 0,
        })),
      });
    }
    return { groups: emptyGroups, loading: false };
  }

  return { groups, loading };
}
