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
