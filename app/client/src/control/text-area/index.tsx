import cx from 'classnames';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useStyle } from './style';

export type TextAreaProps = {
  autoResize?: boolean;
  label?: string;
  layout?: 'horizontal' | 'vertical' | 'inline';
  maxLength?: number;
  name: string;
  onChange?: (newValue: string | undefined) => void;
  onValidChange?: (fieldName: string, newValid: boolean) => void;
  placeholder?: string;
  validate?: (newValue: string) => boolean;
  value: string | undefined;
  variant?: 'outlined' | 'borderless';
};

export const TextArea = ({
  autoResize = false,
  label,
  layout = 'horizontal',
  maxLength,
  name,
  onChange = () => {},
  onValidChange = () => {},
  placeholder,
  validate = () => true,
  value = '',
  variant = 'outlined',
}: TextAreaProps) => {
  const style = useStyle();
  const ref = useRef<HTMLTextAreaElement>(null);

  const [isValid, setIsValid] = useState<boolean>(true);
  const [internalValue, setInternalValue] = useState<string | undefined>(value);
  const [prevValue, setPrevValue] = useState<string | undefined>(value);

  const handleValueChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = event.target.value;
      setInternalValue(newValue);
      if (validate(newValue)) {
        if (isValid === false) {
          setIsValid(true);
          onValidChange(name, true);
        }
        onChange(newValue === '' ? undefined : newValue);
      } else {
        if (isValid === true) {
          setIsValid(false);
          onValidChange(name, false);
        }
      }
    },
    [isValid, name, onChange, onValidChange, validate]
  );

  if (value !== prevValue) {
    setPrevValue(value);
    setInternalValue(value);
  }

  useEffect(() => {
    if (!autoResize || !ref.current) return;
    const el = ref.current;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [autoResize, internalValue]);

  const currentLength = (internalValue ?? '').length;
  const remaining = maxLength !== undefined ? maxLength - currentLength : undefined;
  const showCounter =
    remaining !== undefined && remaining <= Math.max(Math.floor((maxLength ?? 0) * 0.1), 50);

  return (
    <div className={cx(style.root, style[layout])}>
      {label && (
        <label className={cx(style.label, { [`${style.danger}`]: !isValid })}>{label}</label>
      )}
      <div className={style.textareaWrapper}>
        <textarea
          className={cx(style.input, style[variant], { [style.autoResize]: autoResize })}
          maxLength={maxLength}
          name={name}
          onChange={handleValueChange}
          placeholder={placeholder}
          ref={ref}
          style={{ minHeight: autoResize ? '7rem' : '10rem' }}
          value={internalValue}
        />
        {showCounter && (
          <span
            className={cx(
              style.counter,
              remaining !== undefined && remaining <= 0 && style.counterDanger
            )}
          >
            {currentLength}/{maxLength}
          </span>
        )}
      </div>
    </div>
  );
};
