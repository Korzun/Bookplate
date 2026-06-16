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
});
