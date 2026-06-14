import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '~/test-utils';

import { SubjectChips } from './index';

it('renders existing subjects as chips', () => {
  renderWithProviders(
    <SubjectChips value={['Fiction', 'History']} suggestions={[]} onChange={vi.fn()} />
  );
  expect(screen.getByText('Fiction')).toBeInTheDocument();
  expect(screen.getByText('History')).toBeInTheDocument();
});

it('calls onChange without the removed subject when × is clicked', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  renderWithProviders(
    <SubjectChips value={['Fiction', 'History']} suggestions={[]} onChange={onChange} />
  );
  await user.click(screen.getByRole('button', { name: 'Remove Fiction' }));
  expect(onChange).toHaveBeenCalledWith(['History']);
});

it('shows filtered suggestions that match typed text (case-insensitive substring)', async () => {
  const user = userEvent.setup();
  renderWithProviders(
    <SubjectChips value={[]} suggestions={['Fiction', 'History', 'Fantasy']} onChange={vi.fn()} />
  );
  await user.type(screen.getByRole('textbox'), 'fi');
  expect(screen.getByRole('option', { name: 'Fiction' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'History' })).not.toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'Fantasy' })).not.toBeInTheDocument();
});

it('excludes already-added subjects from suggestions', async () => {
  const user = userEvent.setup();
  renderWithProviders(
    <SubjectChips value={['Fiction']} suggestions={['Fiction', 'History']} onChange={vi.fn()} />
  );
  await user.type(screen.getByRole('textbox'), 'fi');
  expect(screen.queryByRole('option', { name: 'Fiction' })).not.toBeInTheDocument();
});

it('calls onChange with new subject when a suggestion is clicked', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  renderWithProviders(<SubjectChips value={[]} suggestions={['Fiction']} onChange={onChange} />);
  await user.type(screen.getByRole('textbox'), 'fi');
  await user.click(screen.getByRole('option', { name: 'Fiction' }));
  expect(onChange).toHaveBeenCalledWith(['Fiction']);
});

it('calls onChange with free-form subject on Enter', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  renderWithProviders(<SubjectChips value={[]} suggestions={[]} onChange={onChange} />);
  await user.type(screen.getByRole('textbox'), 'Sci-Fi{Enter}');
  expect(onChange).toHaveBeenCalledWith(['Sci-Fi']);
});

it('does not call onChange for a duplicate subject', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  renderWithProviders(<SubjectChips value={['Fiction']} suggestions={[]} onChange={onChange} />);
  await user.type(screen.getByRole('textbox'), 'Fiction{Enter}');
  expect(onChange).not.toHaveBeenCalled();
});

it('removes the last chip on Backspace when input is empty', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  renderWithProviders(
    <SubjectChips value={['Fiction', 'History']} suggestions={[]} onChange={onChange} />
  );
  await user.click(screen.getByRole('textbox'));
  await user.keyboard('{Backspace}');
  expect(onChange).toHaveBeenCalledWith(['Fiction']);
});

it('highlights the first suggestion on ArrowDown', async () => {
  const user = userEvent.setup();
  renderWithProviders(
    <SubjectChips value={[]} suggestions={['Fiction', 'History']} onChange={vi.fn()} />
  );
  await user.type(screen.getByRole('textbox'), 'i');
  await user.keyboard('{ArrowDown}');
  const options = screen.getAllByRole('option');
  expect(options[0]).toHaveAttribute('aria-selected', 'true');
  expect(options[1]).toHaveAttribute('aria-selected', 'false');
});

it('selects the highlighted suggestion on Enter', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  renderWithProviders(
    <SubjectChips value={[]} suggestions={['Fiction', 'History']} onChange={onChange} />
  );
  await user.type(screen.getByRole('textbox'), 'i');
  await user.keyboard('{ArrowDown}{Enter}');
  expect(onChange).toHaveBeenCalledWith(['Fiction']);
});
