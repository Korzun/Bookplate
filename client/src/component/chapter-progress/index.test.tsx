// client/src/component/chapter-progress/index.test.tsx
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { ChapterProgress } from './index';

describe('ChapterProgress', () => {
  it('renders "Ch {current} / {total}" when no chapter name is given', () => {
    renderWithProviders(<ChapterProgress current={3} total={10} />);
    expect(screen.getByText('Ch 3 / 10')).toBeInTheDocument();
  });

  it('renders "Ch {current}: {name} / {total}" when a name is given', () => {
    renderWithProviders(<ChapterProgress current={3} total={10} name="The Arrival" />);
    expect(screen.getByText('Ch 3: The Arrival / 10')).toBeInTheDocument();
  });
});
