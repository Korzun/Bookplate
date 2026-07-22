import cx from 'classnames';
import { useState } from 'react';

import { XIcon } from '~/icon';
import type { Theme } from '~/provider/theme';

import { useStyle } from './style';

export type ChipColor = keyof Theme['color']['chip'];

export type ChipsInputProps = {
  value: string[];
  suggestions: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  allowCustom?: boolean;
  disabled?: boolean;
  label?: string;
  layout?: 'horizontal' | 'vertical' | 'block';
  name?: string;
  chipColor?: ChipColor;
  // Matches the control's height to a standard form input (removes the roomier
  // min-height and slims the chips). Used when the field sits inline with other
  // inputs, e.g. the device form; the book-edit Subjects field leaves it off.
  dense?: boolean;
};

export const ChipsInput = ({
  value,
  suggestions,
  onChange,
  placeholder,
  allowCustom = true,
  disabled = false,
  label,
  layout = 'block',
  name,
  chipColor = 'subject',
  dense = false,
}: ChipsInputProps) => {
  const style = useStyle({ chipColor, dense });
  const [inputValue, setInputValue] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const filteredSuggestions = suggestions.filter(
    (s) => !value.includes(s) && s.toLowerCase().includes(inputValue.toLowerCase())
  );

  const showDropdown = !disabled && inputValue.length > 0 && filteredSuggestions.length > 0;

  function addChip(chip: string) {
    const trimmed = chip.trim();
    if (!trimmed || value.includes(trimmed)) return;
    onChange([...value, trimmed]);
    setInputValue('');
    setHighlightedIndex(-1);
  }

  function removeChip(chip: string) {
    if (disabled) return;
    onChange(value.filter((s) => s !== chip));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
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
        addChip(highlighted);
      } else if (allowCustom && inputValue.trim()) {
        e.preventDefault();
        addChip(inputValue);
      }
    } else if (e.key === 'Backspace' && inputValue === '' && value.length > 0) {
      removeChip(value[value.length - 1]!);
    }
  }

  const control = (
    <div className={style.controlRoot}>
      <div className={cx(style.chipsContainer, { [style.disabled]: disabled })}>
        {value.map((chip) => (
          <span key={chip} className={style.chip}>
            {chip}
            <button
              type="button"
              className={style.chipRemove}
              aria-label={`Remove ${chip}`}
              tabIndex={disabled ? -1 : 0}
              onClick={disabled ? undefined : () => removeChip(chip)}
            >
              <XIcon />
            </button>
          </span>
        ))}
        <input
          id={name}
          className={style.input}
          type="text"
          value={inputValue}
          placeholder={value.length === 0 ? placeholder : ''}
          disabled={disabled}
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
                addChip(s);
              }}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  if (!label || layout === 'block') {
    return control;
  }

  return (
    <div className={cx(style.root, style[layout])}>
      <label className={style.label} htmlFor={name}>
        {label}
      </label>
      {control}
    </div>
  );
};
