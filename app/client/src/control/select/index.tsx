import cx from 'classnames';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ChevronIcon, SpinnerIcon } from '~/icon';

import { useStyle } from './style';

export type SelectOption = string | { label: string; value: string; description?: string };

type InternalOption = { label: string; value: string; description?: string; _isCreate?: boolean };

export type SelectProps = {
  allowCreate?: boolean;
  disabled?: boolean;
  label?: string;
  layout?: 'horizontal' | 'vertical' | 'inline';
  loading?: boolean;
  name: string;
  onChange?: (value: string | undefined) => void;
  options: SelectOption[];
  placeholder?: string;
  searchable?: boolean;
  value: string | undefined;
};

function normalise(option: SelectOption): InternalOption {
  return typeof option === 'string' ? { label: option, value: option } : option;
}

function highlight(text: string, query: string, className: string): React.ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className={className}>{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  );
}

export const Select = ({
  allowCreate = false,
  disabled = false,
  label,
  layout = 'horizontal',
  loading = false,
  name,
  onChange = () => {},
  options,
  placeholder = 'Select…',
  searchable = true,
  value,
}: SelectProps) => {
  const style = useStyle();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const normalisedOptions = useMemo(() => options.map(normalise), [options]);
  const filteredOptions = useMemo<InternalOption[]>(
    () => normalisedOptions.filter((o) => o.label.toLowerCase().includes(query.toLowerCase())),
    [normalisedOptions, query]
  );

  const createEntry = useMemo<InternalOption | null>(() => {
    if (!allowCreate || !query.trim()) return null;
    const trimmed = query.trim();
    const exactMatch = normalisedOptions.some(
      (o) => o.label.toLowerCase() === trimmed.toLowerCase()
    );
    if (exactMatch) return null;
    return { label: trimmed, value: trimmed, _isCreate: true };
  }, [allowCreate, query, normalisedOptions]);

  const visibleOptions = useMemo<InternalOption[]>(
    () => (createEntry ? [...filteredOptions, createEntry] : filteredOptions),
    [filteredOptions, createEntry]
  );

  const selectedLabel = normalisedOptions.find((o) => o.value === value)?.label ?? value;

  const open = useCallback(() => {
    if (disabled || loading) return;
    setIsOpen(true);
    setHighlightedIndex(0);
  }, [disabled, loading]);

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setHighlightedIndex(0);
  }, []);

  const select = useCallback(
    (optValue: string) => {
      onChange(optValue);
      close();
    },
    [onChange, close]
  );

  const clear = useCallback(() => {
    onChange(undefined);
  }, [onChange]);

  useEffect(() => {
    if (isOpen && searchable) {
      inputRef.current?.focus();
    }
  }, [isOpen, searchable]);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [close]);

  const handleTriggerKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    },
    [open]
  );

  const handleOpenTriggerKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex((i) =>
          visibleOptions.length === 0 ? 0 : (i + 1) % visibleOptions.length
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex((i) =>
          visibleOptions.length === 0 ? 0 : (i - 1 + visibleOptions.length) % visibleOptions.length
        );
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const opt = visibleOptions[highlightedIndex];
        if (opt) select(opt.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'Tab') {
        close();
      }
    },
    [visibleOptions, highlightedIndex, select, close]
  );

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex((i) =>
          visibleOptions.length === 0 ? 0 : (i + 1) % visibleOptions.length
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex((i) =>
          visibleOptions.length === 0 ? 0 : (i - 1 + visibleOptions.length) % visibleOptions.length
        );
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const opt = visibleOptions[highlightedIndex];
        if (opt) select(opt.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'Tab') {
        close();
      }
    },
    [visibleOptions, highlightedIndex, select, close]
  );

  return (
    <div ref={rootRef} className={cx(style.root, style[layout])}>
      {label && (
        <label className={style.label} htmlFor={name}>
          {label}
        </label>
      )}
      <div className={style.triggerWrapper}>
        {isOpen && searchable ? (
          <div className={style.trigger}>
            <input
              ref={inputRef}
              id={name}
              className={style.searchInput}
              aria-label="Search"
              placeholder="Type to search…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlightedIndex(0);
              }}
              onKeyDown={handleInputKeyDown}
            />
            <span
              className={cx(style.chevron, style.open)}
              role="button"
              tabIndex={-1}
              aria-label="Close"
              onMouseDown={(e) => e.preventDefault()}
              onClick={close}
            >
              <ChevronIcon height={12} width={12} />
            </span>
          </div>
        ) : (
          <div
            className={cx(style.trigger, {
              [style.loading]: loading,
              [style.disabled]: disabled,
              [style.open]: isOpen,
            })}
            role="button"
            tabIndex={disabled || loading ? -1 : 0}
            aria-label={selectedLabel ?? placeholder}
            onClick={isOpen ? close : open}
            onKeyDown={isOpen ? handleOpenTriggerKeyDown : handleTriggerKeyDown}
          >
            {loading && <SpinnerIcon className={style.spinner} />}
            <span className={cx(style.triggerText, { [style.placeholder]: !selectedLabel })}>
              {loading ? 'Loading…' : (selectedLabel ?? placeholder)}
            </span>
            {value && !disabled && !loading && (
              <span
                className={style.clearButton}
                role="button"
                tabIndex={0}
                aria-label="Clear"
                onClick={(e) => {
                  e.stopPropagation();
                  clear();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    clear();
                  }
                }}
              >
                ✕
              </span>
            )}
            <span className={style.chevron}>
              <ChevronIcon height={12} width={12} />
            </span>
          </div>
        )}
        {isOpen && (
          <div className={style.dropdown}>
            <ul className={style.optionList} role="listbox">
              {visibleOptions.length === 0 ? (
                <li
                  className={cx(style.option, style.emptyOption)}
                  role="option"
                  aria-selected={false}
                >
                  No results
                </li>
              ) : (
                visibleOptions.map((opt, index) => (
                  <li
                    key={opt._isCreate ? `__create__${opt.value}` : opt.value}
                    className={cx(style.option, {
                      [style.highlighted]: index === highlightedIndex,
                      [style.selected]: !opt._isCreate && opt.value === value,
                      [style.createOption]: opt._isCreate,
                    })}
                    role="option"
                    aria-selected={!opt._isCreate && opt.value === value}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => select(opt.value)}
                  >
                    {opt._isCreate ? (
                      <>
                        Add: <strong>{opt.label}</strong>
                      </>
                    ) : (
                      <>
                        <div>{highlight(opt.label, query, style.matchHighlight)}</div>
                        {opt.description && (
                          <div className={style.optionDescription}>{opt.description}</div>
                        )}
                      </>
                    )}
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
