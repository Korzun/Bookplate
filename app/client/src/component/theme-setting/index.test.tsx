import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { ThemeSetting } from './index';

describe('ThemeSetting', () => {
  it('renders inside a card with the three theme options', () => {
    renderWithProviders(<ThemeSetting />);
    expect(screen.getByText('Appearance')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Light' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Auto' })).toBeInTheDocument();
  });

  it('selects a mode and persists it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ThemeSetting />);
    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem('theme-setting')).toBe('dark');
  });
});
