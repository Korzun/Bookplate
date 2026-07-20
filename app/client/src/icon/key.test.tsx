import { render } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { KeyIcon } from './key';

describe('KeyIcon', () => {
  it('renders an svg element', () => {
    const { container } = render(<KeyIcon />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('applies className prop', () => {
    const { container } = render(<KeyIcon className="my-icon" />);
    expect(container.querySelector('svg')?.getAttribute('class')).toBe('my-icon');
  });

  it('defaults to 24x24', () => {
    const { container } = render(<KeyIcon />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('24');
    expect(svg.getAttribute('height')).toBe('24');
  });

  it('accepts custom width and height', () => {
    const { container } = render(<KeyIcon width={14} height={14} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('14');
    expect(svg.getAttribute('height')).toBe('14');
  });
});
