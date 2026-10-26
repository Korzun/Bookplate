/**
 * The pieces a `DateTimeInput` edits: a `YYYY-MM-DD` string for the native
 * date input and an `HH:MM` string for the native time input, both in UTC.
 * Either may be empty.
 */
export type IsoDateParts = { date: string; time: string };

const EMPTY: IsoDateParts = { date: '', time: '' };

// The server's `ISO_8601_RE`, split into the groups this control cares about:
// year, optional month, optional day, optional time (with optional seconds,
// fraction and offset). Precision below the day is edited at minute level.
const ISO_DATE_RE =
  /^(\d{4})(?:-(\d{2})(?:-(\d{2})(T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?)?)?$/;

const pad = (n: number) => String(n).padStart(2, '0');

const isRealDate = (year: number, month: number, day: number) => {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
};

/**
 * Splits a stored `publishDate` into date and time parts. Lower-precision
 * values (year, year-month) are filled out to the first of the period — the
 * same reading the book page already gives them via `new Date(...)`. A
 * timestamp is normalised to UTC; one with no offset is taken to be UTC
 * already, matching how the rest of the app formats these values. Anything
 * unreadable yields empty parts.
 */
export function splitIsoDate(value: string | undefined): IsoDateParts {
  if (!value) return EMPTY;
  const match = ISO_DATE_RE.exec(value.trim());
  if (match === null) return EMPTY;
  const [, year, month = '01', day = '01', time, offset] = match;

  if (!isRealDate(Number(year), Number(month), Number(day))) return EMPTY;

  if (time === undefined) {
    return { date: `${year}-${month}-${day}`, time: '' };
  }

  const instant = new Date(`${year}-${month}-${day}${time}${offset === undefined ? 'Z' : ''}`);
  if (Number.isNaN(instant.getTime())) return EMPTY;

  return {
    date: `${instant.getUTCFullYear()}-${pad(instant.getUTCMonth() + 1)}-${pad(instant.getUTCDate())}`,
    time: `${pad(instant.getUTCHours())}:${pad(instant.getUTCMinutes())}`,
  };
}

/**
 * The inverse: builds the string to store. No date means no value at all,
 * whatever the time input holds; a date alone is stored bare; a date with a
 * time becomes a UTC timestamp at second precision.
 */
export function composeIsoDate(date: string, time: string): string | undefined {
  if (date === '') return undefined;
  if (time === '') return date;
  return `${date}T${time}:00Z`;
}
