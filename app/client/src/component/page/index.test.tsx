import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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

  it('renders no action chrome when no action props are given', () => {
    renderWithProviders(<Page>content</Page>);
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument();
  });

  it('renders the mobile back button when back is given', () => {
    renderWithProviders(<Page back="/library">content</Page>);
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });

  it('renders header actions as a desktop bar and a mobile menu trigger', () => {
    renderWithProviders(
      <Page headerActions={[{ label: 'Edit', onClick: vi.fn(), primary: true }]}>
        content
      </Page>
    );
    // Desktop bar shows the primary action inline.
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    // Mobile "⋯" menu trigger is also rendered (CSS hides one per breakpoint).
    expect(screen.getAllByRole('button', { name: 'More actions' }).length).toBeGreaterThan(0);
  });

  it('renders footer actions', () => {
    renderWithProviders(
      <Page footerActions={[{ label: 'Save', onClick: vi.fn(), emphasis: true }]}>
        content
      </Page>
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});
