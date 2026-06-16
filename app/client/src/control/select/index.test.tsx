import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { Select } from './index';

const options = ['Fantasy', 'Horror', 'Science Fiction', 'Thriller'];

describe('Select', () => {
  describe('closed state', () => {
    it('shows placeholder when no value selected', () => {
      renderWithProviders(
        <Select name="genre" options={options} value={undefined} placeholder="Pick a genre…" />
      );
      expect(screen.getByRole('button', { name: 'Pick a genre…' })).toBeInTheDocument();
    });

    it('shows selected label when value is set', () => {
      renderWithProviders(<Select name="genre" options={options} value="Science Fiction" />);
      expect(screen.getByRole('button', { name: 'Science Fiction' })).toBeInTheDocument();
    });

    it('shows clear button when a value is selected', () => {
      renderWithProviders(<Select name="genre" options={options} value="Horror" />);
      expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
    });

    it('hides clear button when no value is selected', () => {
      renderWithProviders(<Select name="genre" options={options} value={undefined} />);
      expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
    });

    it('calls onChange(undefined) when clear is clicked', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderWithProviders(
        <Select name="genre" options={options} value="Horror" onChange={onChange} />
      );
      await user.click(screen.getByRole('button', { name: 'Clear' }));
      expect(onChange).toHaveBeenCalledWith(undefined);
    });

    it('shows label text for object option whose value matches', () => {
      const objOptions = [
        { label: 'Science Fiction', value: 'sci-fi' },
        { label: 'Fantasy', value: 'fantasy' },
      ];
      renderWithProviders(<Select name="genre" options={objOptions} value="sci-fi" />);
      expect(screen.getByRole('button', { name: 'Science Fiction' })).toBeInTheDocument();
    });
  });

  describe('open state', () => {
    it('opens dropdown on click', async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <Select name="genre" options={options} value={undefined} placeholder="Pick…" />
      );
      await user.click(screen.getByRole('button', { name: 'Pick…' }));
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('shows all options when opened', async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <Select name="genre" options={options} value={undefined} placeholder="Pick…" />
      );
      await user.click(screen.getByRole('button', { name: 'Pick…' }));
      expect(screen.getAllByRole('option')).toHaveLength(4);
    });

    it('filters options as user types', async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <Select name="genre" options={options} value={undefined} placeholder="Pick…" />
      );
      await user.click(screen.getByRole('button', { name: 'Pick…' }));
      await user.type(screen.getByRole('textbox', { name: 'Search' }), 'sci');
      const opts = screen.getAllByRole('option');
      expect(opts).toHaveLength(1);
      expect(opts[0]).toHaveTextContent('Science Fiction');
    });

    it('shows No results when query matches nothing', async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <Select name="genre" options={options} value={undefined} placeholder="Pick…" />
      );
      await user.click(screen.getByRole('button', { name: 'Pick…' }));
      await user.type(screen.getByRole('textbox', { name: 'Search' }), 'xyz');
      expect(screen.getByRole('option')).toHaveTextContent('No results');
    });

    it('calls onChange with the option value when an option is clicked', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderWithProviders(
        <Select
          name="genre"
          options={options}
          value={undefined}
          placeholder="Pick…"
          onChange={onChange}
        />
      );
      await user.click(screen.getByRole('button', { name: 'Pick…' }));
      await user.click(screen.getAllByRole('option')[2]); // Science Fiction
      expect(onChange).toHaveBeenCalledWith('Science Fiction');
    });

    it('calls onChange with the object value field when object options used', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const objOptions = [
        { label: 'Science Fiction', value: 'sci-fi' },
        { label: 'Fantasy', value: 'fantasy' },
      ];
      renderWithProviders(
        <Select
          name="genre"
          options={objOptions}
          value={undefined}
          placeholder="Pick…"
          onChange={onChange}
        />
      );
      await user.click(screen.getByRole('button', { name: 'Pick…' }));
      await user.click(screen.getAllByRole('option')[0]);
      expect(onChange).toHaveBeenCalledWith('sci-fi');
    });

    it('closes after selecting an option', async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <Select
          name="genre"
          options={options}
          value={undefined}
          placeholder="Pick…"
          onChange={vi.fn()}
        />
      );
      await user.click(screen.getByRole('button', { name: 'Pick…' }));
      await user.click(screen.getAllByRole('option')[0]);
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('closes when clicking outside', async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <Select name="genre" options={options} value={undefined} placeholder="Pick…" />
      );
      await user.click(screen.getByRole('button', { name: 'Pick…' }));
      await user.click(document.body);
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });

  describe('keyboard navigation', () => {
    it('opens on ArrowDown from the trigger', async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <Select name="genre" options={options} value={undefined} placeholder="Pick…" />
      );
      screen.getByRole('button', { name: 'Pick…' }).focus();
      await user.keyboard('{ArrowDown}');
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('selects the first option on Enter immediately after opening', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderWithProviders(
        <Select
          name="genre"
          options={options}
          value={undefined}
          placeholder="Pick…"
          onChange={onChange}
        />
      );
      screen.getByRole('button', { name: 'Pick…' }).focus();
      await user.keyboard('{ArrowDown}'); // open; highlight=0 (Fantasy)
      await user.keyboard('{Enter}');
      expect(onChange).toHaveBeenCalledWith('Fantasy');
    });

    it('moves highlight down with ArrowDown and selects on Enter', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderWithProviders(
        <Select
          name="genre"
          options={options}
          value={undefined}
          placeholder="Pick…"
          onChange={onChange}
        />
      );
      screen.getByRole('button', { name: 'Pick…' }).focus();
      await user.keyboard('{ArrowDown}'); // open; highlight=0
      await user.keyboard('{ArrowDown}'); // highlight=1 (Horror)
      await user.keyboard('{Enter}');
      expect(onChange).toHaveBeenCalledWith('Horror');
    });

    it('closes on Escape without calling onChange', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderWithProviders(
        <Select
          name="genre"
          options={options}
          value={undefined}
          placeholder="Pick…"
          onChange={onChange}
        />
      );
      screen.getByRole('button', { name: 'Pick…' }).focus();
      await user.keyboard('{ArrowDown}');
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('loading state', () => {
    it('shows Loading… text when loading', () => {
      renderWithProviders(<Select name="genre" options={[]} value={undefined} loading />);
      expect(screen.getByText('Loading…')).toBeInTheDocument();
    });

    it('does not open when loading', async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <Select name="genre" options={[]} value={undefined} loading placeholder="Pick…" />
      );
      // tabIndex is -1 when loading, but we can still fire a click on the element
      const trigger = screen.getByText('Loading…').closest('div[role="button"]') as HTMLElement;
      await user.click(trigger);
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });

  describe('disabled state', () => {
    it('does not open when disabled', async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <Select name="genre" options={options} value={undefined} disabled placeholder="Pick…" />
      );
      await user.click(screen.getByRole('button', { name: 'Pick…' }));
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('hides clear button when disabled even with a value', () => {
      renderWithProviders(<Select name="genre" options={options} value="Fantasy" disabled />);
      expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
    });
  });
});
