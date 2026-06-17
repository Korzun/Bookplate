import cx from 'classnames';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { BookListFilter } from '~/provider/book';
import type { Suggestion, SuggestionGroup } from './use-search-suggestions';
import { useSearchSuggestions } from './use-search-suggestions';
import { useStyle } from './style';

const STATUS_LABELS: Record<string, string> = {
  'not-started': 'Not Started',
  'in-progress': 'In Progress',
  completed: 'Completed',
};

type ChipDef =
  | { kind: 'status'; value: string }
  | { kind: 'author'; value: string }
  | { kind: 'series'; value: string }
  | { kind: 'subject'; value: string };

function filterToChips(filter: BookListFilter): ChipDef[] {
  const chips: ChipDef[] = [];
  if (filter.status) chips.push({ kind: 'status', value: STATUS_LABELS[filter.status] ?? filter.status });
  if (filter.author) chips.push({ kind: 'author', value: filter.author });
  if (filter.seriesName) chips.push({ kind: 'series', value: filter.seriesName });
  for (const s of filter.subjects ?? []) chips.push({ kind: 'subject', value: s });
  return chips;
}

function removeChip(filter: BookListFilter, chip: ChipDef): BookListFilter {
  switch (chip.kind) {
    case 'status':  return { ...filter, status: undefined };
    case 'author':  return { ...filter, author: undefined };
    case 'series':  return { ...filter, seriesName: undefined };
    case 'subject': return { ...filter, subjects: filter.subjects?.filter(s => s !== chip.value) };
  }
}

function applySelection(filter: BookListFilter, suggestion: Suggestion): BookListFilter {
  switch (suggestion.type) {
    case 'status':  return { ...filter, status: suggestion.value as BookListFilter['status'] };
    case 'author':  return { ...filter, author: suggestion.value };
    case 'series':  return { ...filter, seriesName: suggestion.value };
    case 'subject': return { ...filter, subjects: [...(filter.subjects ?? []), suggestion.value] };
  }
}

function renderHighlighted(
  text: string,
  matchStart: number,
  matchLength: number,
  matchClass: string
): React.ReactNode {
  if (matchLength === 0) return text;
  return (
    <>
      {text.slice(0, matchStart)}
      <span className={matchClass}>{text.slice(matchStart, matchStart + matchLength)}</span>
      {text.slice(matchStart + matchLength)}
    </>
  );
}

const TYPE_CHIP_CLASS: Record<ChipDef['kind'], string> = {
  status: 'chipStatus',
  author: 'chipAuthor',
  series: 'chipSeries',
  subject: 'chipSubject',
};

const TYPE_CHIP_LABEL: Record<ChipDef['kind'], string> = {
  status: 'Status',
  author: 'Author',
  series: 'Series',
  subject: 'Subject',
};

const TYPE_DROPDOWN_CLASS: Record<Suggestion['type'], string> = {
  status: 'dropdownItemTypeStatus',
  author: 'dropdownItemTypeAuthor',
  series: 'dropdownItemTypeSeries',
  subject: 'dropdownItemTypeSubject',
};

interface SearchBarProps {
  filter: BookListFilter;
  onChange: (filter: BookListFilter) => void;
}

export function SearchBar({ filter, onChange }: SearchBarProps) {
  const style = useStyle();
  const [inputValue, setInputValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const suggestions = useSearchSuggestions(inputValue, filter);
  const flatSuggestions: Suggestion[] = suggestions.flatMap((g: SuggestionGroup) => g.items);

  const chips = filterToChips(filter);
  const hasAnyActive = chips.length > 0 || !!filter.query;

  const open = useCallback(() => {
    setIsOpen(true);
    setHighlightedIndex(0);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setHighlightedIndex(0);
  }, []);

  const commitQuery = useCallback(() => {
    const q = inputValue.trim();
    if (q) onChange({ ...filter, query: q });
    else if (filter.query) onChange({ ...filter, query: undefined });
    close();
  }, [inputValue, filter, onChange, close]);

  const selectSuggestion = useCallback(
    (suggestion: Suggestion) => {
      onChange(applySelection(filter, suggestion));
      setInputValue('');
      close();
    },
    [filter, onChange, close]
  );

  const clearAll = useCallback(() => {
    onChange({});
    setInputValue('');
    close();
  }, [onChange, close]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [close]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex(i =>
          flatSuggestions.length === 0 ? 0 : (i + 1) % flatSuggestions.length
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex(i =>
          flatSuggestions.length === 0 ? 0 : (i - 1 + flatSuggestions.length) % flatSuggestions.length
        );
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const s = flatSuggestions[highlightedIndex];
        if (s) selectSuggestion(s);
        else commitQuery();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    },
    [flatSuggestions, highlightedIndex, selectSuggestion, commitQuery, close]
  );

  let flatIndex = 0;

  return (
    <div ref={rootRef} className={cx(style.root, { [style.focused]: isOpen })}>
      {chips.length > 0 && (
        <>
          <div className={style.chipsRow}>
            {chips.map((chip, i) => (
              <span
                key={`${chip.kind}-${chip.value}-${i}`}
                className={cx(style.chip, style[TYPE_CHIP_CLASS[chip.kind] as keyof typeof style])}
              >
                <span className={style.chipTypeLabel}>{TYPE_CHIP_LABEL[chip.kind]}</span>
                {chip.value}
                <button
                  type="button"
                  className={style.chipRemove}
                  aria-label={`Remove ${chip.kind} filter`}
                  onClick={() => onChange(removeChip(filter, chip))}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
          <div className={style.divider} />
        </>
      )}
      <div className={style.inputRow}>
        <span className={style.searchIcon} aria-hidden>⌕</span>
        <input
          ref={inputRef}
          className={style.input}
          placeholder={chips.length > 0 ? 'Search titles…' : 'Search by title, author, series, subject, or status…'}
          value={inputValue}
          onChange={e => {
            setInputValue(e.target.value);
            setHighlightedIndex(0);
            if (!isOpen) open();
          }}
          onFocus={open}
          onKeyDown={handleKeyDown}
          aria-label="Search library"
          aria-expanded={isOpen}
          aria-autocomplete="list"
        />
        {hasAnyActive && (
          <button type="button" className={style.clearButton} aria-label="Clear search" onClick={clearAll}>
            ✕
          </button>
        )}
      </div>
      {isOpen && flatSuggestions.length > 0 && (
        <div className={style.dropdown} role="listbox">
          {suggestions.map(group => (
            <div key={group.type} className={style.dropdownGroup}>
              <div className={style.dropdownGroupLabel}>{group.label}</div>
              {group.items.map(item => {
                const idx = flatIndex++;
                return (
                  <div
                    key={item.value}
                    className={cx(style.dropdownItem, {
                      [style.dropdownItemHighlighted]: idx === highlightedIndex,
                    })}
                    role="option"
                    aria-selected={idx === highlightedIndex}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => selectSuggestion(item)}
                  >
                    <span className={cx(style.dropdownItemType, style[TYPE_DROPDOWN_CLASS[item.type] as keyof typeof style])}>
                      {group.label}
                    </span>
                    <span className={style.dropdownItemText}>
                      {renderHighlighted(item.label, item.matchStart, item.matchLength, style.dropdownItemMatch)}
                    </span>
                    {item.additive && <span className={style.dropdownItemAdditive}>＋</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
