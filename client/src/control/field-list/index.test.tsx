import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '~/test-utils';

import { FieldList, type FieldRow } from './index';

const singleTextColumn = [{ type: 'text' as const, key: 'value', placeholder: 'Subject' }];

it('renders the add button with addLabel', () => {
  renderWithProviders(
    <FieldList
      addLabel="Add subject"
      columns={singleTextColumn}
      rows={[]}
      onAdd={vi.fn()}
      onRemove={vi.fn()}
      onChange={vi.fn()}
    />
  );
  expect(screen.getByRole('button', { name: 'Add subject' })).toBeInTheDocument();
});

it('calls onAdd when the add button is clicked', async () => {
  const user = userEvent.setup();
  const onAdd = vi.fn();
  renderWithProviders(
    <FieldList
      addLabel="Add subject"
      columns={singleTextColumn}
      rows={[]}
      onAdd={onAdd}
      onRemove={vi.fn()}
      onChange={vi.fn()}
    />
  );
  await user.click(screen.getByRole('button', { name: 'Add subject' }));
  expect(onAdd).toHaveBeenCalledOnce();
});

it('renders an input for each row', () => {
  const rows: FieldRow[] = [
    { _key: 'key-1', value: 'fiction' },
    { _key: 'key-2', value: 'thriller' },
  ];
  renderWithProviders(
    <FieldList
      addLabel="Add subject"
      columns={singleTextColumn}
      rows={rows}
      onAdd={vi.fn()}
      onRemove={vi.fn()}
      onChange={vi.fn()}
    />
  );
  expect(screen.getByDisplayValue('fiction')).toBeInTheDocument();
  expect(screen.getByDisplayValue('thriller')).toBeInTheDocument();
});

it('calls onRemove with the row key when the remove button is clicked', async () => {
  const user = userEvent.setup();
  const onRemove = vi.fn();
  const rows: FieldRow[] = [{ _key: 'key-abc', value: 'fiction' }];
  renderWithProviders(
    <FieldList
      addLabel="Add subject"
      columns={singleTextColumn}
      rows={rows}
      onAdd={vi.fn()}
      onRemove={onRemove}
      onChange={vi.fn()}
    />
  );
  await user.click(screen.getByRole('button', { name: 'Remove row' }));
  expect(onRemove).toHaveBeenCalledWith('key-abc');
});

it('calls onChange with rowKey, fieldKey, and new value when typing', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const rows: FieldRow[] = [{ _key: 'key-1', value: '' }];
  renderWithProviders(
    <FieldList
      addLabel="Add subject"
      columns={singleTextColumn}
      rows={rows}
      onAdd={vi.fn()}
      onRemove={vi.fn()}
      onChange={onChange}
    />
  );
  await user.type(screen.getByPlaceholderText('Subject'), 'a');
  expect(onChange).toHaveBeenCalledWith('key-1', 'value', 'a');
});

it('renders two inputs per row for a two-column config', () => {
  const twoColumns = [
    { type: 'text' as const, key: 'scheme', placeholder: 'Scheme' },
    { type: 'text' as const, key: 'value', placeholder: 'Value' },
  ];
  const rows: FieldRow[] = [{ _key: 'key-1', scheme: 'isbn', value: '978-0' }];
  renderWithProviders(
    <FieldList
      addLabel="Add identifier"
      columns={twoColumns}
      rows={rows}
      onAdd={vi.fn()}
      onRemove={vi.fn()}
      onChange={vi.fn()}
    />
  );
  expect(screen.getByDisplayValue('isbn')).toBeInTheDocument();
  expect(screen.getByDisplayValue('978-0')).toBeInTheDocument();
});

it('forwards onValidChange when validate returns false', async () => {
  const user = userEvent.setup();
  const onValidChange = vi.fn();
  const columns = [
    {
      type: 'text' as const,
      key: 'value',
      placeholder: 'Subject',
      validate: (v: string) => v.length > 0,
    },
  ];
  const rows: FieldRow[] = [{ _key: 'key-1', value: 'hello' }];
  renderWithProviders(
    <FieldList
      addLabel="Add subject"
      columns={columns}
      rows={rows}
      onAdd={vi.fn()}
      onRemove={vi.fn()}
      onChange={vi.fn()}
      onValidChange={onValidChange}
    />
  );
  await user.clear(screen.getByDisplayValue('hello'));
  expect(onValidChange).toHaveBeenCalledWith('key-1.value', false);
});

it('calls onChange with undefined when a field is cleared', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const rows: FieldRow[] = [{ _key: 'key-1', value: 'hello' }];
  renderWithProviders(
    <FieldList
      addLabel="Add subject"
      columns={singleTextColumn}
      rows={rows}
      onAdd={vi.fn()}
      onRemove={vi.fn()}
      onChange={onChange}
    />
  );
  await user.clear(screen.getByDisplayValue('hello'));
  expect(onChange).toHaveBeenCalledWith('key-1', 'value', undefined);
});

it('forwards onValidChange with true when field recovers from invalid', async () => {
  const user = userEvent.setup();
  const onValidChange = vi.fn();
  const columns = [
    {
      type: 'text' as const,
      key: 'value',
      placeholder: 'Subject',
      validate: (v: string) => v.length > 0,
    },
  ];
  const rows: FieldRow[] = [{ _key: 'key-1', value: 'hello' }];
  renderWithProviders(
    <FieldList
      addLabel="Add subject"
      columns={columns}
      rows={rows}
      onAdd={vi.fn()}
      onRemove={vi.fn()}
      onChange={vi.fn()}
      onValidChange={onValidChange}
    />
  );
  await user.clear(screen.getByDisplayValue('hello'));
  await user.type(screen.getByPlaceholderText('Subject'), 'x');
  expect(onValidChange).toHaveBeenCalledWith('key-1.value', true);
});
