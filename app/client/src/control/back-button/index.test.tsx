import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vite-plus/test';

import { renderWithProviders } from '~/test-utils';

import { BackButton } from './index';

function LibraryProbe() {
  const state = useLocation().state as { restoreScroll?: boolean } | null;
  return (
    <div>
      <div>Library page</div>
      {state?.restoreScroll && <div>restore requested</div>}
    </div>
  );
}

function renderAt(to: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/from" element={<BackButton to={to} />} />
      <Route path="/library" element={<LibraryProbe />} />
    </Routes>,
    { initialEntries: ['/from'] }
  );
}

describe('BackButton', () => {
  it('renders a button labelled "Back"', () => {
    renderAt('/library');
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });

  it('navigates to the `to` path when clicked', async () => {
    const user = userEvent.setup();
    renderAt('/library');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Library page')).toBeInTheDocument();
  });

  it('navigates on Enter key', async () => {
    const user = userEvent.setup();
    renderAt('/library');
    screen.getByRole('button', { name: 'Back' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('Library page')).toBeInTheDocument();
  });

  it('asks the destination to restore its scroll position', async () => {
    const user = userEvent.setup();
    renderAt('/library');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('restore requested')).toBeInTheDocument();
  });
});
