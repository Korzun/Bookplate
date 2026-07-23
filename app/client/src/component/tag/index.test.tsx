import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { Tag } from './index';

describe('Tag', () => {
  it('renders the compact variant only when size="sm"', () => {
    renderWithProviders(
      <>
        <Tag>Default</Tag>
        <Tag size="sm">Compact</Tag>
      </>
    );
    // react-jss embeds the rule name in the generated class, so the compact
    // `sm` rule is present on the small chip and absent on the default one.
    expect(screen.getByText('Default').className).not.toMatch(/\bsm\b|sm-/);
    expect(screen.getByText('Compact').className).toMatch(/sm/);
  });
});
