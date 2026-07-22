import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '~/test-utils';

import { ChipsInput } from './index';

it('renders existing values as chips', () => {
  renderWithProviders(
    <ChipsInput value={['Fiction', 'History']} suggestions={[]} onChange={vi.fn()} />
  );
  expect(screen.getByText('Fiction')).toBeInTheDocument();
  expect(screen.getByText('History')).toBeInTheDocument();
});

it('adds a suggestion by clicking it in the dropdown', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  renderWithProviders(<ChipsInput value={[]} suggestions={['Fiction']} onChange={onChange} />);
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  await user.type(screen.getByRole('textbox'), 'fi');
  expect(screen.getByRole('option', { name: 'Fiction' })).toBeInTheDocument();
  await user.click(screen.getByRole('option', { name: 'Fiction' }));
  expect(onChange).toHaveBeenCalledWith(['Fiction']);
});

it('adds the highlighted suggestion via Enter', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  renderWithProviders(
    <ChipsInput value={[]} suggestions={['Fiction', 'History']} onChange={onChange} />
  );
  await user.type(screen.getByRole('textbox'), 'i');
  await user.keyboard('{ArrowDown}{Enter}');
  expect(onChange).toHaveBeenCalledWith(['Fiction']);
});

it('allowCustom (default true): typing free text and pressing Enter adds it as a chip', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  renderWithProviders(<ChipsInput value={[]} suggestions={[]} onChange={onChange} />);
  await user.type(screen.getByRole('textbox'), 'Sci-Fi{Enter}');
  expect(onChange).toHaveBeenCalledWith(['Sci-Fi']);
});

it('allowCustom={false}: typing text matching no suggestion and pressing Enter does not add a chip', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  renderWithProviders(
    <ChipsInput value={[]} suggestions={['Fiction']} onChange={onChange} allowCustom={false} />
  );
  await user.type(screen.getByRole('textbox'), 'Nonexistent{Enter}');
  expect(onChange).not.toHaveBeenCalled();
});

it('allowCustom={false}: a real suggestion can still be added via Enter when highlighted', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  renderWithProviders(
    <ChipsInput value={[]} suggestions={['Fiction']} onChange={onChange} allowCustom={false} />
  );
  await user.type(screen.getByRole('textbox'), 'Fiction');
  await user.keyboard('{ArrowDown}{Enter}');
  expect(onChange).toHaveBeenCalledWith(['Fiction']);
});

it('removes a chip via its remove button', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  renderWithProviders(
    <ChipsInput value={['Fiction', 'History']} suggestions={[]} onChange={onChange} />
  );
  await user.click(screen.getByRole('button', { name: 'Remove Fiction' }));
  expect(onChange).toHaveBeenCalledWith(['History']);
});

it('removes the last chip on Backspace when input is empty', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  renderWithProviders(
    <ChipsInput value={['Fiction', 'History']} suggestions={[]} onChange={onChange} />
  );
  await user.click(screen.getByRole('textbox'));
  await user.keyboard('{Backspace}');
  expect(onChange).toHaveBeenCalledWith(['Fiction']);
});

it('disabled: the input is disabled and typing does nothing', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  renderWithProviders(
    <ChipsInput value={[]} suggestions={['Fiction']} onChange={onChange} disabled />
  );
  const input = screen.getByRole('textbox');
  expect(input).toBeDisabled();
  await user.type(input, 'fi');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
});

it('disabled: chip remove buttons are inert and clicking does not call onChange', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  renderWithProviders(
    <ChipsInput value={['Fiction']} suggestions={[]} onChange={onChange} disabled />
  );
  const removeButton = screen.getByRole('button', { name: 'Remove Fiction' });
  expect(removeButton).toHaveAttribute('tabindex', '-1');
  await user.click(removeButton);
  expect(onChange).not.toHaveBeenCalled();
});

it('chipColor="user": still renders chip text and a working remove button', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  renderWithProviders(
    <ChipsInput value={['alice']} suggestions={[]} onChange={onChange} chipColor="user" />
  );
  expect(screen.getByText('alice')).toBeInTheDocument();
  const removeButton = screen.getByRole('button', { name: 'Remove alice' });
  expect(removeButton).toBeInTheDocument();
  await user.click(removeButton);
  expect(onChange).toHaveBeenCalledWith([]);
});

it('label + layout="horizontal": renders a label associated with the input', () => {
  renderWithProviders(
    <ChipsInput
      value={[]}
      suggestions={[]}
      onChange={vi.fn()}
      label="Users"
      layout="horizontal"
      name="users"
    />
  );
  expect(screen.getByLabelText('Users')).toBeInTheDocument();
});
