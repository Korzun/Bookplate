import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { Page } from './index';

describe('Page', () => {
  it('renders its children inside a main region', () => {
    renderWithProviders(<Page>hello library</Page>);
    expect(document.querySelector('main')).toHaveTextContent('hello library');
  });

  it('renders no background noise overlay', () => {
    const { container } = renderWithProviders(<Page>content</Page>);
    expect(container.querySelector('#page-noise')).toBeNull();
  });
});
