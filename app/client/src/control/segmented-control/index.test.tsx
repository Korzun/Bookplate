import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { SegmentedControl } from './index';

const options = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'auto', label: 'Auto' },
];

describe('SegmentedControl', () => {
  it('renders a radiogroup with one radio per option', () => {
    renderWithProviders(
      <SegmentedControl name="theme" value="light" options={options} onChange={vi.fn()} />
    );
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('marks the selected option as checked', () => {
    renderWithProviders(
      <SegmentedControl name="theme" value="dark" options={options} onChange={vi.fn()} />
    );
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'false');
  });

  it('calls onChange when an option is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(
      <SegmentedControl name="theme" value="light" options={options} onChange={onChange} />
    );
    await user.click(screen.getByRole('radio', { name: 'Auto' }));
    expect(onChange).toHaveBeenCalledWith('auto');
  });

  it('moves selection with ArrowRight', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(
      <SegmentedControl name="theme" value="light" options={options} onChange={onChange} />
    );
    screen.getByRole('radio', { name: 'Light' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('dark');
  });

  it('does not call onChange when disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(
      <SegmentedControl name="theme" value="light" options={options} disabled onChange={onChange} />
    );
    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
