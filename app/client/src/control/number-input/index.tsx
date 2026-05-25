import cx from 'classnames';
import { useCallback, useState } from 'react';

import { isNumeric } from '~/utils';

import { useStyle } from './style';

export type NumberInputProps = {
  label: string | undefined;
  layout?: 'horizontal' | 'vertical' | 'inline';
  name: string;
  onChange?: (newValue: number | undefined) => void;
  onValidChange?: (fieldName: string, newValid: boolean) => void;
  placeholder?: string;
  validate?: (newValue: string) => boolean;
  value: number | undefined;
};

export const NumberInput = ({
  label,
  layout = 'horizontal',
  name,
  onChange = () => {},
  onValidChange = () => {},
  placeholder,
  validate = (newValue) => newValue === '' || isNumeric(newValue),
  value,
}: NumberInputProps) => {
  const style = useStyle();

  const [isValid, setIsValid] = useState<boolean>(true);
  const [internalValue, setInternalValue] = useState<string | undefined>(
    value !== undefined ? String(value) : undefined
  );
  const [prevValue, setPrevValue] = useState<number | undefined>(value);

  const handleValueChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = event.target.value;
      setInternalValue(newValue);
      if (validate(newValue)) {
        if (isValid === false) {
          setIsValid(true);
          onValidChange(name, true);
        }
        onChange(newValue === '' ? undefined : parseFloat(newValue));
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
    setInternalValue(value !== undefined ? String(value) : undefined);
  }

  return (
    <div className={cx(style.root, style[layout])}>
      {label && (
        <label className={cx(style.label, { [`${style.danger}`]: !isValid })}>{label}</label>
      )}
      <input
        name={name}
        className={cx(style.input, { [`${style.danger}`]: !isValid })}
        onChange={handleValueChange}
        placeholder={placeholder}
        value={internalValue === undefined ? '' : internalValue}
      />
    </div>
  );
};
