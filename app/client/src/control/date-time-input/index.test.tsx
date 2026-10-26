import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { DateTimeInput } from './index';

const dateInput = (container: HTMLElement) =>
  container.querySelector('input[type="date"]') as HTMLInputElement;
const timeInput = (container: HTMLElement) =>
  container.querySelector('input[type="time"]') as HTMLInputElement;

describe('DateTimeInput', () => {
  it('shows the date and time parts of a UTC timestamp in native inputs', () => {
    const { container } = renderWithProviders(
      <DateTimeInput label="Publish Date" name="publishDate" value="2021-01-01T16:00:00+00:00" />
    );
    expect(dateInput(container).value).toBe('2021-01-01');
    expect(timeInput(container).value).toBe('16:00');
  });

  it('names the date input after the field so the form can find it', () => {
    const { container } = renderWithProviders(
      <DateTimeInput label="Publish Date" name="publishDate" value="2023-06-06" />
    );
    expect(dateInput(container).name).toBe('publishDate');
  });

  it('disables the time input until a date is set', () => {
    const { container } = renderWithProviders(
      <DateTimeInput label="Publish Date" name="publishDate" value={undefined} />
    );
    expect(timeInput(container).disabled).toBe(true);
    fireEvent.change(dateInput(container), { target: { value: '2023-06-06' } });
    expect(timeInput(container).disabled).toBe(false);
  });

  it('calls onChange with the bare date when only a date is picked', () => {
    const onChange = vi.fn();
    const { container } = renderWithProviders(
      <DateTimeInput
        label="Publish Date"
        name="publishDate"
        value={undefined}
        onChange={onChange}
      />
    );
    fireEvent.change(dateInput(container), { target: { value: '2023-06-06' } });
    expect(onChange).toHaveBeenLastCalledWith('2023-06-06');
  });

  it('calls onChange with a UTC timestamp once a time is added', () => {
    const onChange = vi.fn();
    const { container } = renderWithProviders(
      <DateTimeInput
        label="Publish Date"
        name="publishDate"
        value="2023-06-06"
        onChange={onChange}
      />
    );
    fireEvent.change(timeInput(container), { target: { value: '16:30' } });
    expect(onChange).toHaveBeenLastCalledWith('2023-06-06T16:30:00Z');
  });

  it('drops back to the bare date when the time is cleared', () => {
    const onChange = vi.fn();
    const { container } = renderWithProviders(
      <DateTimeInput
        label="Publish Date"
        name="publishDate"
        value="2023-06-06T16:30:00Z"
        onChange={onChange}
      />
    );
    fireEvent.change(timeInput(container), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith('2023-06-06');
  });

  it('clears the time too and reports no value when the date is cleared', () => {
    const onChange = vi.fn();
    const { container } = renderWithProviders(
      <DateTimeInput
        label="Publish Date"
        name="publishDate"
        value="2023-06-06T16:30:00Z"
        onChange={onChange}
      />
    );
    fireEvent.change(dateInput(container), { target: { value: '' } });
    expect(timeInput(container).value).toBe('');
    expect(timeInput(container).disabled).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('shows a year-only value as the first of January', () => {
    const { container } = renderWithProviders(
      <DateTimeInput label="Publish Date" name="publishDate" value="1965" />
    );
    expect(dateInput(container).value).toBe('1965-01-01');
    expect(timeInput(container).value).toBe('');
  });

  it('displays the updated value when the external value prop changes', () => {
    const { container, rerender } = renderWithProviders(
      <DateTimeInput label="Publish Date" name="publishDate" value="2023-06-06" />
    );
    rerender(
      <DateTimeInput label="Publish Date" name="publishDate" value="2024-01-02T09:00:00Z" />
    );
    expect(dateInput(container).value).toBe('2024-01-02');
    expect(timeInput(container).value).toBe('09:00');
  });
});
