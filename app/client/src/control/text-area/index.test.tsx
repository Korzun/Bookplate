import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '~/test-utils';

import { TextArea } from './index';

it('renders a textarea element', () => {
  renderWithProviders(<TextArea name="desc" value="hello" />);
  expect(screen.getByRole('textbox')).toBeInTheDocument();
});

it('applies minHeight 10rem when autoResize is not set', () => {
  renderWithProviders(<TextArea name="desc" value="" />);
  const el = screen.getByRole('textbox');
  expect(el).toHaveStyle({ minHeight: '10rem' });
});

it('applies minHeight 7rem when autoResize is true', () => {
  renderWithProviders(<TextArea name="desc" value="" autoResize />);
  const el = screen.getByRole('textbox');
  expect(el).toHaveStyle({ minHeight: '7rem' });
});

it('sets height on the textarea after mount when autoResize is true', () => {
  renderWithProviders(<TextArea name="desc" value="some content" autoResize />);
  const el = screen.getByRole('textbox') as HTMLTextAreaElement;
  // jsdom scrollHeight is 0, so height resolves to '0px' — we verify the property was written
  expect(el.style.height).not.toBe('');
});

it('updates height when value changes with autoResize', async () => {
  const user = userEvent.setup();
  renderWithProviders(<TextArea name="desc" value="" autoResize onChange={() => {}} />);
  const el = screen.getByRole('textbox') as HTMLTextAreaElement;
  // Mock scrollHeight to return a non-zero value so we can detect change
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => 200 });
  await user.type(el, 'a');
  expect(el.style.height).toBe('200px');
});

it('does not set height on the textarea when autoResize is false', () => {
  renderWithProviders(<TextArea name="desc" value="some content" />);
  const el = screen.getByRole('textbox') as HTMLTextAreaElement;
  expect(el.style.height).toBe('');
});

it('does not show counter when maxLength is not provided', () => {
  renderWithProviders(<TextArea name="desc" value={'a'.repeat(95)} />);
  expect(screen.queryByText(/\d+\/\d+/)).not.toBeInTheDocument();
});

it('does not show counter when remaining characters exceed threshold', () => {
  renderWithProviders(<TextArea name="desc" value={'a'.repeat(40)} maxLength={500} />);
  expect(screen.queryByText(/\d+\/\d+/)).not.toBeInTheDocument();
});

it('shows counter when remaining characters are within 10% threshold', () => {
  renderWithProviders(<TextArea name="desc" value={'a'.repeat(460)} maxLength={500} />);
  expect(screen.getByText('460/500')).toBeInTheDocument();
});

it('shows counter within 50-char window even when > 10% remains (50-char floor)', () => {
  // maxLength=200: 10% = 20, threshold = max(20, 50) = 50; remaining = 45 → shows
  renderWithProviders(<TextArea name="desc" value={'a'.repeat(155)} maxLength={200} />);
  expect(screen.getByText('155/200')).toBeInTheDocument();
});

it('does not show counter when remaining characters exceed threshold', () => {
  // maxLength=1000: threshold = max(100, 50) = 100; remaining = 150 → hidden
  renderWithProviders(<TextArea name="desc" value={'a'.repeat(850)} maxLength={1000} />);
  expect(screen.queryByText(/\d+\/\d+/)).not.toBeInTheDocument();
});
