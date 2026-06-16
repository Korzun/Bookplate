import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { CoverImagePicker } from './index';

// jsdom does not implement URL.createObjectURL — stub it for all tests in this file
Object.defineProperty(URL, 'createObjectURL', {
  writable: true,
  value: vi.fn().mockReturnValue('blob:mock-url'),
});
Object.defineProperty(URL, 'revokeObjectURL', {
  writable: true,
  value: vi.fn(),
});

const FILE = new File(['x'.repeat(1_048_576)], 'cover.jpg', { type: 'image/jpeg' }); // 1 MB

describe('CoverImagePicker — idle (no file selected)', () => {
  it('renders "No image selected"', () => {
    renderWithProviders(<CoverImagePicker value={undefined} onChange={vi.fn()} />);
    expect(screen.getByText('No image selected')).toBeInTheDocument();
  });

  it('renders "Choose image…" button', () => {
    renderWithProviders(<CoverImagePicker value={undefined} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Choose image…' })).toBeInTheDocument();
  });

  it('does not render a "Clear" button', () => {
    renderWithProviders(<CoverImagePicker value={undefined} onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
  });

  it('clicking "Choose image…" triggers the hidden file input', async () => {
    const user = userEvent.setup();
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    renderWithProviders(<CoverImagePicker value={undefined} onChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Choose image…' }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });
});

describe('CoverImagePicker — selected (file provided)', () => {
  it('renders the filename', () => {
    renderWithProviders(<CoverImagePicker value={FILE} onChange={vi.fn()} />);
    expect(screen.getByText('cover.jpg')).toBeInTheDocument();
  });

  it('renders file size in MB', () => {
    renderWithProviders(<CoverImagePicker value={FILE} onChange={vi.fn()} />);
    expect(screen.getByText('1.0 MB')).toBeInTheDocument();
  });

  it('renders "Change…" button instead of "Choose image…"', () => {
    renderWithProviders(<CoverImagePicker value={FILE} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Change…' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose image…' })).not.toBeInTheDocument();
  });

  it('renders "Clear" button', () => {
    renderWithProviders(<CoverImagePicker value={FILE} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
  });

  it('renders a thumbnail img with the object URL', () => {
    renderWithProviders(<CoverImagePicker value={FILE} onChange={vi.fn()} />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'blob:mock-url');
  });

  it('clicking "Clear" calls onChange with undefined', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<CoverImagePicker value={FILE} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('clicking "Change…" triggers the hidden file input', async () => {
    const user = userEvent.setup();
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    renderWithProviders(<CoverImagePicker value={FILE} onChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Change…' }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });
});

describe('CoverImagePicker — file input', () => {
  it('calls onChange with the selected file when the input changes', () => {
    const onChange = vi.fn();
    renderWithProviders(<CoverImagePicker value={undefined} onChange={onChange} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([''], 'new.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    expect(onChange).toHaveBeenCalledWith(file);
  });
});
