import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { Button } from './index';

describe('Button', () => {
  it('is not disabled and fires onClick when interactive', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderWithProviders(<Button onClick={onClick}>Save</Button>);

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).not.toHaveAttribute('aria-disabled');

    await user.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('marks itself disabled and blocks activation when disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderWithProviders(
      <Button disabled onClick={onClick}>
        Save
      </Button>
    );

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAttribute('tabindex', '-1');

    await user.click(button);
    button.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('marks itself disabled and blocks activation when loading', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderWithProviders(
      <Button loading onClick={onClick}>
        Save
      </Button>
    );

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAttribute('tabindex', '-1');

    await user.click(button);
    button.focus();
    await user.keyboard('{Enter}');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('honors the incoming tabIndex when interactive', () => {
    renderWithProviders(<Button tabIndex={3}>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('tabindex', '3');
  });
});

describe('Button submit mode', () => {
  it('renders a native submit button and associates via the form attribute', () => {
    renderWithProviders(
      <Button submit form="my-form">
        Save
      </Button>
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'submit');
    expect(button).toHaveAttribute('form', 'my-form');
  });

  it('submits its parent form on click', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    renderWithProviders(
      <form onSubmit={onSubmit}>
        <Button submit>Go</Button>
      </form>
    );
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('is natively disabled when loading and does not submit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    renderWithProviders(
      <form onSubmit={onSubmit}>
        <Button submit loading>
          Go
        </Button>
      </form>
    );
    const button = screen.getByRole('button', { name: 'Go' });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
