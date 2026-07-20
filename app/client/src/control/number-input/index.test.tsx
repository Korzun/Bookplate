// client/src/control/number-input/index.test.tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vite-plus/test';

import { renderWithProviders } from '~/test-utils';

import { NumberInput } from './index';

describe('NumberInput', () => {
  it('calls onChange with the parsed number when a valid value is typed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(
      <NumberInput label="Series index" name="seriesIndex" value={undefined} onChange={onChange} />
    );
    const input = document.querySelector('input[name="seriesIndex"]') as HTMLElement;
    await user.type(input, '42');
    expect(onChange).toHaveBeenLastCalledWith(42);
  });

  it('calls onChange with undefined when the field is cleared', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(
      <NumberInput label="Series index" name="seriesIndex" value={5} onChange={onChange} />
    );
    await user.clear(screen.getByDisplayValue('5'));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('calls onValidChange(name, false) when an invalid string is entered', async () => {
    const user = userEvent.setup();
    const onValidChange = vi.fn();
    renderWithProviders(
      <NumberInput label="Index" name="idx" value={undefined} onValidChange={onValidChange} />
    );
    const input = document.querySelector('input[name="idx"]') as HTMLElement;
    await user.type(input, 'abc');
    expect(onValidChange).toHaveBeenCalledWith('idx', false);
  });

  it('calls onValidChange(name, true) when the field recovers from invalid', async () => {
    const user = userEvent.setup();
    const onValidChange = vi.fn();
    renderWithProviders(
      <NumberInput label="Index" name="idx" value={undefined} onValidChange={onValidChange} />
    );
    const input = document.querySelector('input[name="idx"]') as HTMLElement;
    await user.type(input, 'abc');
    await user.clear(input);
    await user.type(input, '5');
    expect(onValidChange).toHaveBeenCalledWith('idx', true);
  });

  it('displays the updated value when the external value prop changes', () => {
    const { rerender } = renderWithProviders(<NumberInput label="Index" name="idx" value={1} />);
    expect(screen.getByDisplayValue('1')).toBeInTheDocument();
    rerender(<NumberInput label="Index" name="idx" value={99} />);
    expect(screen.getByDisplayValue('99')).toBeInTheDocument();
  });
});
