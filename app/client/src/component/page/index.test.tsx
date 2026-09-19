import { screen, within } from '@testing-library/react';
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
      <Page headerActions={[{ label: 'Edit', onClick: vi.fn(), primary: true }]}>content</Page>
    );
    // Desktop bar shows the primary action inline.
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    // Mobile "⋯" menu trigger is also rendered (CSS hides one per breakpoint).
    expect(screen.getAllByRole('button', { name: 'More actions' }).length).toBeGreaterThan(0);
  });

  /**
   * Every default page renders the header row, actions or not, and the row
   * holds a floor height on desktop (`style.ts`). That is what stops a page
   * with an actions bar and a page without one from starting their content at
   * different heights — switching between `/add`'s Upload and Request views
   * used to jolt, because only one of them publishes actions.
   */
  it('holds the header row open on a page with no actions at all', () => {
    const { container } = renderWithProviders(<Page>content</Page>);

    const header = container.querySelector('header');
    expect(header).toBeInTheDocument();
    // Empty, not absent: the height is reserved by CSS, so there is nothing
    // to render into it.
    expect(header).toBeEmptyDOMElement();
  });

  it('puts the desktop actions bar in that row', () => {
    const { container } = renderWithProviders(
      <Page headerActions={[{ label: 'Edit', onClick: vi.fn(), primary: true }]}>content</Page>
    );

    expect(
      within(container.querySelector('header')!).getByRole('button', { name: 'Edit' })
    ).toBeInTheDocument();
  });

  it("puts a page's own header content in that same row", () => {
    const { container } = renderWithProviders(
      <Page header={<div>a search bar</div>}>content</Page>
    );

    // The point of the slot: a page whose own chrome belongs at the top gets
    // it at the SAME height as everyone else's actions, rather than pushed
    // down by a blank reserved row.
    expect(
      within(container.querySelector('header')!).getByText('a search bar')
    ).toBeInTheDocument();
  });

  it('renders no header row on a minimal page', () => {
    // Login, loading and the forced password change: no nav, no actions, and
    // nothing to line up with.
    const { container } = renderWithProviders(<Page type="minimal">content</Page>);

    expect(container.querySelector('header')).toBeNull();
  });

  it('renders footer actions', () => {
    renderWithProviders(
      <Page footerActions={[{ label: 'Save', onClick: vi.fn(), emphasis: true }]}>content</Page>
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});
