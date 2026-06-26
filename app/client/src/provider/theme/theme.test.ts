import { describe, expect, it } from 'vitest';

import { defaultTheme } from './theme';

describe('defaultTheme glass tokens', () => {
  it('exposes a full-capsule pill radius', () => {
    expect(defaultTheme.radius.pill).toBe('999px');
  });

  it('derives the translucent glass fill from white', () => {
    expect(defaultTheme.color.bg.glass).toBe('rgba(255, 255, 255, 0.6)');
    expect(defaultTheme.color.bg.glassFallback).toBe('rgba(255, 255, 255, 0.92)');
  });

  it('defines an easing for the highlight slide', () => {
    expect(defaultTheme.transition.spring).toBe('0.35s cubic-bezier(0.4, 0, 0.2, 1)');
  });

  it('builds recipe.glass from the glass tokens (no hardcoded values)', () => {
    const glass = defaultTheme.recipe.glass;
    expect(glass.backgroundColor).toBe(defaultTheme.color.bg.glass);
    expect(glass.borderColor).toBe(defaultTheme.color.border.glass);
    expect(glass.boxShadow).toBe(defaultTheme.shadow.glass);
    expect(glass.backdropFilter).toBe('blur(20px) saturate(180%)');
    expect(glass['-webkit-backdrop-filter']).toBe('blur(20px) saturate(180%)');
  });

  it('builds recipe.glassHighlight (the active-tab lens) from the active-glass tokens', () => {
    const lens = defaultTheme.recipe.glassHighlight;
    expect(lens.backgroundColor).toBe(defaultTheme.color.bg.glassActive);
    expect(lens.borderColor).toBe(defaultTheme.color.border.glassActive);
    expect(lens.boxShadow).toBe(defaultTheme.shadow.glassActive);
  });
});
