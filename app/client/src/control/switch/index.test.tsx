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

  /**
   * The track is the switch's only unlabelled child element, and the radius
   * class is hashed by JSS, so these compare classes across renders rather
   * than asserting any literal name: the default must MATCH an explicit
   * `inset` and DIFFER from `pill`. That is falsifiable in the way that
   * matters — a `radius` prop that never reached the track would pass the
   * first and fail the second.
   */
  const trackClass = (container: HTMLElement): string => {
    // Found via the thumb — the one div in either layout with no children of
    // its own — because a plain `div` query matches the `row` WRAPPER first,
    // which carries no radius class and made this comparison vacuous.
    const divs = [...container.querySelectorAll('[role="switch"] div')];
    const thumb = divs.find((div) => div.children.length === 0);
    if (thumb?.parentElement == null) throw new Error('no track rendered');
    return thumb.parentElement.className;
  };

  it('defaults to the inset radius, concentric with the row it sits in', () => {
    const { container: byDefault } = renderWithProviders(
      <Switch name="dark-mode" checked={false} onChange={vi.fn()} />
    );
    const { container: explicit } = renderWithProviders(
      <Switch name="dark-mode" checked={false} onChange={vi.fn()} radius="inset" />
    );
    expect(trackClass(byDefault)).toBe(trackClass(explicit));
  });

  it('gives the track a different shape when asked for a pill', () => {
    const { container: inset } = renderWithProviders(
      <Switch name="dark-mode" checked={false} onChange={vi.fn()} radius="inset" />
    );
    const { container: pill } = renderWithProviders(
      <Switch name="dark-mode" checked={false} onChange={vi.fn()} radius="pill" />
    );
    expect(trackClass(pill)).not.toBe(trackClass(inset));
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

  it('toggles when the description is clicked in the horizontal layout', async () => {
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
    await user.click(screen.getByText('Helper text explaining the toggle'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
