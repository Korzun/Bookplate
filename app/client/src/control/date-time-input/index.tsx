import cx from 'classnames';
import { useCallback, useId, useState } from 'react';

import { composeIsoDate, splitIsoDate } from './iso-date';
import { useStyle } from './style';

export type DateTimeInputProps = {
  label?: string;
  layout?: 'horizontal' | 'vertical' | 'inline';
  name: string;
  onChange?: (newValue: string | undefined) => void;
  /**
   * An ISO 8601 date string as the server stores it: a bare date, a
   * timestamp, or a lower-precision year / year-month. `undefined` and `''`
   * both mean "no date".
   */
  value: string | undefined;
};

/**
 * A date with an optional time, edited through the browser's native pickers
 * so the user never has to know the stored format. The two inputs are
 * independent: a time can only be set once there is a date, and clearing the
 * date takes the time with it. `onChange` receives the recomposed string
 * (`composeIsoDate`), or `undefined` when the date is cleared.
 */
export const DateTimeInput = ({
  label,
  layout = 'horizontal',
  name,
  onChange = () => {},
  value,
}: DateTimeInputProps) => {
  const style = useStyle();
  const dateId = useId();

  const [parts, setParts] = useState(() => splitIsoDate(value));
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setParts(splitIsoDate(value));
  }

  const update = useCallback(
    (next: { date: string; time: string }) => {
      setParts(next);
      onChange(composeIsoDate(next.date, next.time));
    },
    [onChange]
  );

  const handleDateChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const date = event.target.value;
      update({ date, time: date === '' ? '' : parts.time });
    },
    [parts.time, update]
  );

  const handleTimeChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      update({ date: parts.date, time: event.target.value });
    },
    [parts.date, update]
  );

  return (
    <div className={cx(style.root, style[layout])}>
      {label && (
        <label className={style.label} htmlFor={dateId}>
          {label}
        </label>
      )}
      <div className={style.inputContainer}>
        <input
          className={cx(style.input, style.date)}
          id={dateId}
          name={name}
          onChange={handleDateChange}
          type="date"
          value={parts.date}
        />
        <input
          aria-label={label ? `${label} time` : 'Time'}
          className={cx(style.input, style.time)}
          disabled={parts.date === ''}
          name={`${name}Time`}
          onChange={handleTimeChange}
          type="time"
          value={parts.time}
        />
      </div>
    </div>
  );
};
