// client/src/control/switch/index.test.tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { Switch } from './index';

describe('Switch', () => {
  it('renders with role="switch" and correct aria-checked', () => {
    renderWithProviders(<Switch name="dark-mode" checked={true} onChange={vi.fn()} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('calls onChange with the toggled value when clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<Switch name="dark-mode" checked={false} onChange={onChange} />);
    await user.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('calls onChange when Enter is pressed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<Switch name="dark-mode" checked={false} onChange={onChange} />);
    screen.getByRole('switch').focus();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('calls onChange when Space is pressed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<Switch name="dark-mode" checked={false} onChange={onChange} />);
    screen.getByRole('switch').focus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('does not call onChange when disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<Switch name="dark-mode" checked={false} disabled onChange={onChange} />);
    await user.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders the label text when provided', () => {
    renderWithProviders(
      <Switch name="dark-mode" checked={false} label="Dark mode" onChange={vi.fn()} />
    );
    expect(screen.getByText('Dark mode')).toBeInTheDocument();
  });

  it('renders a description and links it via aria-describedby', () => {
    renderWithProviders(
      <Switch
        name="simplify"
        checked={false}
        label="Simplify"
        description="Helper text explaining the toggle"
        onChange={vi.fn()}
      />
    );
    const description = screen.getByText('Helper text explaining the toggle');
    expect(description).toBeInTheDocument();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-describedby', description.id);
  });

  it('does not toggle when the description is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(
      <Switch
        name="simplify"
        checked={false}
        label="Simplify"
        description="Helper text explaining the toggle"
        onChange={onChange}
      />
    );
    await user.click(screen.getByText('Helper text explaining the toggle'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders label and description and still toggles in the horizontal layout', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(
      <Switch
        name="grayscale"
        checked={false}
        label="Grayscale"
        description="Helper text explaining the toggle"
        layout="horizontal"
        onChange={onChange}
      />
    );
    expect(screen.getByText('Grayscale')).toBeInTheDocument();
    expect(screen.getByText('Helper text explaining the toggle')).toBeInTheDocument();
    await user.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
