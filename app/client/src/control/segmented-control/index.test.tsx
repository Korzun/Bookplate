import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { HandOkIcon, ThumbDownIcon } from '~/icon';
import { renderWithProviders } from '~/test-utils';

import { SegmentedControl } from './index';

const options = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'auto', label: 'Auto' },
] as const;

const iconOptions = [
  { value: 'bad', label: 'Bad', Icon: ThumbDownIcon },
  { value: 'okay', label: 'Okay', Icon: HandOkIcon },
] as const;

const css = () =>
  Array.from(document.querySelectorAll('style'))
    .map((el) => el.textContent ?? '')
    .join('\n');

describe('SegmentedControl', () => {
  it('renders a radiogroup with one radio per option and the value checked', () => {
    renderWithProviders(
      <SegmentedControl label="theme" value="dark" options={options} onChange={vi.fn()} />
    );
    expect(screen.getByRole('radiogroup', { name: 'theme' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute('tabindex', '-1');
  });

  it('calls onChange when an option is clicked, and not for the checked one unless clearable', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = renderWithProviders(
      <SegmentedControl label="theme" value="light" options={options} onChange={onChange} />
    );
    await user.click(screen.getByRole('radio', { name: 'Auto' }));
    expect(onChange).toHaveBeenLastCalledWith('auto');
    await user.click(screen.getByRole('radio', { name: 'Light' }));
    expect(onChange).toHaveBeenCalledTimes(1);

    rerender(
      <SegmentedControl
        label="theme"
        value="light"
        options={options}
        clearable
        onChange={onChange}
      />
    );
    await user.click(screen.getByRole('radio', { name: 'Light' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('arrows step without wrapping; Home and End jump; digits pick directly', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = renderWithProviders(
      <SegmentedControl label="theme" value="light" options={options} onChange={onChange} />
    );
    screen.getByRole('radio', { name: 'Light' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('dark');
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenCalledTimes(1);
    await user.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith('auto');
    await user.keyboard('3');
    expect(onChange).toHaveBeenLastCalledWith('auto');
    await user.keyboard('4');
    expect(onChange).toHaveBeenCalledTimes(3);

    onChange.mockClear();
    rerender(<SegmentedControl label="theme" value="auto" options={options} onChange={onChange} />);
    screen.getByRole('radio', { name: 'Auto' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).not.toHaveBeenCalled();
    await user.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith('light');
  });

  it('Backspace and Delete clear only a clearable control', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = renderWithProviders(
      <SegmentedControl label="theme" value="dark" options={options} onChange={onChange} />
    );
    screen.getByRole('radio', { name: 'Dark' }).focus();
    await user.keyboard('{Backspace}{Delete}');
    expect(onChange).not.toHaveBeenCalled();

    rerender(
      <SegmentedControl
        label="theme"
        value="dark"
        options={options}
        clearable
        onChange={onChange}
      />
    );
    await user.keyboard('{Backspace}');
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('read-only (no onChange) renders aria-disabled radios and ignores clicks and keys', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SegmentedControl label="theme" value="dark" options={options} />);
    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-disabled', 'true');
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toHaveAttribute('aria-disabled', 'true');
      expect(radio).toHaveAttribute('tabindex', '-1');
    }
    await user.click(screen.getByRole('radio', { name: 'Auto' }));
    screen.getByRole('radio', { name: 'Dark' }).focus();
    await user.keyboard('{ArrowRight}{Home}{Enter} ');
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
  });

  // The brand colour is not painted on the checked segment itself but on a
  // second copy of the row, clipped to the lens, so a segment lights up as
  // the lens passes over it — the mobile nav's reveal. No lens, no reveal.
  it('draws a lens and a decorative copy of every segment only while something is checked', () => {
    const { rerender } = renderWithProviders(
      <SegmentedControl label="theme" value="dark" options={options} onChange={vi.fn()} />
    );
    const group = screen.getByRole('radiogroup');
    expect(group.style.getPropertyValue('--seg-count')).toBe('3');
    expect(group.style.getPropertyValue('--seg-index')).toBe('1');
    const reveal = screen.getByTestId('segmented-reveal');
    expect(reveal).toHaveAttribute('aria-hidden', 'true');
    for (const { label } of options) expect(screen.getAllByText(label)).toHaveLength(2);
    // Lens + three radios + reveal; only the radios are in the tree.
    expect(group.children).toHaveLength(5);
    expect(screen.getAllByRole('radio')).toHaveLength(3);

    rerender(<SegmentedControl label="theme" value={null} options={options} onChange={vi.fn()} />);
    expect(screen.queryByTestId('segmented-reveal')).not.toBeInTheDocument();
    expect(group.children).toHaveLength(3);
    for (const { label } of options) expect(screen.getAllByText(label)).toHaveLength(1);
  });

  it('icon options draw the icon over a caption, drop the caption when asked, and title the group', () => {
    const { rerender } = renderWithProviders(
      <SegmentedControl label="rating" value="okay" options={iconOptions} onChange={vi.fn()} />
    );
    const group = screen.getByRole('radiogroup');
    expect(group).toHaveAttribute('title', 'Okay');
    const okay = screen.getByRole('radio', { name: 'Okay' });
    expect(okay.querySelector('svg')).not.toBeNull();
    expect(okay).toHaveTextContent('Okay');

    rerender(
      <SegmentedControl
        label="rating"
        value="okay"
        options={iconOptions}
        showLabels={false}
        onChange={vi.fn()}
      />
    );
    expect(within(screen.getByRole('radio', { name: 'Okay' })).queryByText('Okay')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Okay' }).querySelector('svg')).not.toBeNull();
  });

  it('text options keep their label whatever showLabels says, and set no title', () => {
    renderWithProviders(
      <SegmentedControl
        label="theme"
        value="dark"
        options={options}
        showLabels={false}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveTextContent('Dark');
    expect(screen.getByRole('radiogroup')).not.toHaveAttribute('title');
  });

  it('paints its own track on a card and none on the row surface', () => {
    const transparent = (group: HTMLElement) =>
      Array.from(group.classList).some((cls) =>
        new RegExp(`\\.${cls}\\s*\\{[^}]*background-color:\\s*transparent`).test(css())
      );
    const { rerender } = renderWithProviders(
      <SegmentedControl label="theme" value="dark" options={options} onChange={vi.fn()} />
    );
    expect(transparent(screen.getByRole('radiogroup'))).toBe(false);
    rerender(
      <SegmentedControl
        label="theme"
        value="dark"
        options={options}
        surface="row"
        onChange={vi.fn()}
      />
    );
    expect(transparent(screen.getByRole('radiogroup'))).toBe(true);
  });
});
