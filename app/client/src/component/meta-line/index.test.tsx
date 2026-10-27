import { describe, expect, it } from 'vitest';

import { metaItems, renderWithProviders } from '~/test-utils';

import { MetaLine } from './index';

const renderLine = renderWithProviders;

describe('MetaLine', () => {
  it('renders each datum in its own item, in order', () => {
    const { container } = renderLine(<MetaLine items={['Frank Herbert', 'Book 3', '42%']} />);
    expect(metaItems(container)).toEqual(['Frank Herbert', 'Book 3', '42%']);
  });

  it('keeps the separators out of the DOM text', () => {
    const { container } = renderLine(<MetaLine items={['Frank Herbert', 'Book 3']} />);
    expect(container.textContent).toBe('Frank HerbertBook 3');
    expect(container.textContent).not.toContain('·');
  });

  it('accepts element items alongside strings', () => {
    const { getAllByTestId, getByLabelText } = renderLine(
      <MetaLine
        items={[
          'Frank Herbert',
          <span key="r" aria-label="Rated Great">
            Great
          </span>,
        ]}
      />
    );
    expect(getByLabelText('Rated Great')).toBeInTheDocument();
    expect(getAllByTestId('meta-item')).toHaveLength(2);
  });

  it('skips null, undefined and false items', () => {
    const { container } = renderLine(
      <MetaLine items={[null, 'Frank Herbert', undefined, false, '42%']} />
    );
    expect(metaItems(container)).toEqual(['Frank Herbert', '42%']);
  });

  it('renders nothing at all when there is no datum to show', () => {
    // `renderWithProviders` wraps `ui` in one container div of its own.
    const { container } = renderLine(<MetaLine items={[]} />);
    expect(container.firstElementChild).toBeEmptyDOMElement();
  });

  it('passes className through to the outer element', () => {
    const { container } = renderLine(<MetaLine items={['x']} className="muted" />);
    expect(container.firstElementChild).toHaveClass('muted');
  });
});
