import { render } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { MoreIcon } from './more';

describe('MoreIcon', () => {
  it('renders an svg element', () => {
    const { container } = render(<MoreIcon />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('applies className prop', () => {
    const { container } = render(<MoreIcon className="my-icon" />);
    expect(container.querySelector('svg')?.getAttribute('class')).toBe('my-icon');
  });

  it('defaults to 24x24', () => {
    const { container } = render(<MoreIcon />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('24');
    expect(svg.getAttribute('height')).toBe('24');
  });

  it('accepts custom width and height', () => {
    const { container } = render(<MoreIcon width={20} height={20} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('20');
    expect(svg.getAttribute('height')).toBe('20');
  });
});
