import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { BookRequestForm, type BookRequestFormValues } from './index';

// Located by `name`, not `getByLabelText`: `control/text-input` and
// `control/text-area` render a bare sibling `<label>` never wired to their
// field — the same reason `component/book-requests-content`'s suite gives.
// `renderWithProviders`, not Apollo's: the form runs no queries, but its
// react-jss styles still need the theme.
const titleInput = (container: HTMLElement) =>
  container.querySelector('input[name="title"]') as HTMLInputElement;
const authorInput = (container: HTMLElement) =>
  container.querySelector('input[name="author"]') as HTMLInputElement;
const noteInput = (container: HTMLElement) =>
  container.querySelector('textarea[name="note"]') as HTMLTextAreaElement;

const dune: BookRequestFormValues = { title: 'Dune', author: 'Frank Herbert', note: 'hardback' };

describe('BookRequestForm', () => {
  it('will not submit without both title and author', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    const { container } = renderWithProviders(
      <BookRequestForm submitLabel="Request" onSubmit={onSubmit} />
    );

    await user.type(titleInput(container), 'Dune');
    await user.click(screen.getByRole('button', { name: /request/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Author is required')).toBeInTheDocument();
  });

  it('will not submit a whitespace-only author', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    const { container } = renderWithProviders(
      <BookRequestForm submitLabel="Request" onSubmit={onSubmit} />
    );

    await user.type(titleInput(container), 'Dune');
    await user.type(authorInput(container), '   ');
    await user.click(screen.getByRole('button', { name: /request/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Author is required')).toBeInTheDocument();
  });

  it('submits trimmed values', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    const { container } = renderWithProviders(
      <BookRequestForm submitLabel="Request" onSubmit={onSubmit} />
    );

    await user.type(titleInput(container), '  Dune ');
    await user.type(authorInput(container), ' Frank Herbert ');
    await user.type(noteInput(container), ' note ');
    await user.click(screen.getByRole('button', { name: /request/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Dune',
      author: 'Frank Herbert',
      note: 'note',
    });
  });

  it('clears itself after a successful create', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    const { container } = renderWithProviders(
      <BookRequestForm submitLabel="Request" onSubmit={onSubmit} />
    );

    await user.type(titleInput(container), 'Dune');
    await user.type(authorInput(container), 'Frank Herbert');
    await user.type(noteInput(container), 'hardback');
    await user.click(screen.getByRole('button', { name: /request/i }));

    await waitFor(() => expect(titleInput(container)).toHaveValue(''));
    expect(authorInput(container)).toHaveValue('');
    expect(noteInput(container)).toHaveValue('');
  });

  it('shows the message and keeps the values when submit fails', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => 'Too many');
    const { container } = renderWithProviders(
      <BookRequestForm submitLabel="Request" onSubmit={onSubmit} />
    );

    await user.type(titleInput(container), 'Dune');
    await user.type(authorInput(container), 'Frank Herbert');
    await user.click(screen.getByRole('button', { name: /request/i }));

    expect(await screen.findByText('Too many')).toBeInTheDocument();
    expect(titleInput(container)).toHaveValue('Dune');
    expect(authorInput(container)).toHaveValue('Frank Herbert');
  });

  it('prefills from initial, keeps the values after saving, and offers Cancel', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    const onCancel = vi.fn();
    const { container } = renderWithProviders(
      <BookRequestForm initial={dune} submitLabel="Save" onSubmit={onSubmit} onCancel={onCancel} />
    );

    expect(titleInput(container)).toHaveValue('Dune');
    expect(authorInput(container)).toHaveValue('Frank Herbert');
    expect(noteInput(container)).toHaveValue('hardback');

    await user.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(dune));
    // With `initial`, the parent unmounts the form on success; it never
    // blanks the fields underneath the reader first.
    // The submit button is disabled while busy, so re-enabled means the
    // post-`onSubmit` branch has run — the assertion below is not vacuous.
    await waitFor(() => expect(screen.getByRole('button', { name: /save/i })).toBeEnabled());
    expect(authorInput(container)).toHaveValue('Frank Herbert');

    onSubmit.mockClear();
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('offers no Cancel without onCancel', () => {
    renderWithProviders(<BookRequestForm submitLabel="Request" onSubmit={async () => undefined} />);

    expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();
  });
});
