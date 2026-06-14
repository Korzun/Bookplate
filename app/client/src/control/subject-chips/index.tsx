import cx from 'classnames';
import { useState } from 'react';

import { useStyle } from './style';

type Props = {
  value: string[];
  suggestions: string[];
  onChange: (subjects: string[]) => void;
};

export const SubjectChips = ({ value, suggestions, onChange }: Props) => {
  const style = useStyle();
  const [inputValue, setInputValue] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const filteredSuggestions = suggestions.filter(
    (s) => !value.includes(s) && s.toLowerCase().includes(inputValue.toLowerCase())
  );

  const showDropdown = inputValue.length > 0 && filteredSuggestions.length > 0;

  function addSubject(subject: string) {
    const trimmed = subject.trim();
    if (!trimmed || value.includes(trimmed)) return;
    onChange([...value, trimmed]);
    setInputValue('');
    setHighlightedIndex(-1);
  }

  function removeSubject(subject: string) {
    onChange(value.filter((s) => s !== subject));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev < filteredSuggestions.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      const highlighted = filteredSuggestions[highlightedIndex];
      if (highlightedIndex >= 0 && highlighted) {
        e.preventDefault();
        addSubject(highlighted);
      } else if (inputValue.trim()) {
        e.preventDefault();
        addSubject(inputValue);
      }
    } else if (e.key === 'Backspace' && inputValue === '' && value.length > 0) {
      removeSubject(value[value.length - 1]!);
    }
  }

  return (
    <div className={style.root}>
      <div className={style.chipsContainer}>
        {value.map((subject) => (
          <span key={subject} className={style.chip}>
            {subject}
            <button
              type="button"
              className={style.chipRemove}
              aria-label={`Remove ${subject}`}
              onClick={() => removeSubject(subject)}
            >
              ×
            </button>
          </span>
        ))}
        <input
          className={style.input}
          type="text"
          value={inputValue}
          placeholder={value.length === 0 ? 'Add subject…' : ''}
          onChange={(e) => {
            setInputValue(e.target.value);
            setHighlightedIndex(-1);
          }}
          onKeyDown={handleKeyDown}
        />
      </div>
      {showDropdown && (
        <ul className={style.dropdown} role="listbox">
          {filteredSuggestions.map((s, i) => (
            <li
              key={s}
              role="option"
              aria-selected={i === highlightedIndex}
              className={cx(style.dropdownItem, { [style.highlighted]: i === highlightedIndex })}
              onMouseDown={(e) => {
                e.preventDefault();
                addSubject(s);
              }}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
