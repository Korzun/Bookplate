import { describe, expect, it } from 'vitest';

import { defaultTheme, lightTheme, darkTheme } from './theme';

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

describe('semantic tokens replacing raw-scale refs (light)', () => {
  it('border.faint equals gray[500]', () => {
    expect(defaultTheme.color.border.faint).toBe(defaultTheme.color.gray[500]);
  });
  it('brand.linkHover equals blue[300]', () => {
    expect(defaultTheme.color.brand.linkHover).toBe(defaultTheme.color.blue[300]);
  });
  it('bg.selected equals blue[100]', () => {
    expect(defaultTheme.color.bg.selected).toBe(defaultTheme.color.blue[100]);
  });
});

// Relative luminance of a #rrggbb hex, 0 (black) – 1 (white).
const luminance = (hex: string): number => {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

describe('light/dark themes', () => {
  it('defaultTheme is the light theme', () => {
    expect(defaultTheme).toBe(lightTheme);
  });

  it('dark theme has a dark page and light primary text', () => {
    expect(luminance(darkTheme.color.bg.page)).toBeLessThan(0.2);
    expect(luminance(darkTheme.color.text.primary)).toBeGreaterThan(0.7);
  });

  it('light theme has a light page and dark primary text', () => {
    expect(luminance(lightTheme.color.bg.page)).toBeGreaterThan(0.9);
    expect(luminance(lightTheme.color.text.primary)).toBeLessThan(0.2);
  });

  it('carries colorScheme matching the mode', () => {
    expect(lightTheme.colorScheme).toBe('light');
    expect(darkTheme.colorScheme).toBe('dark');
  });

  it('shares identical structural tokens across modes', () => {
    expect(darkTheme.space).toEqual(lightTheme.space);
    expect(darkTheme.radius).toEqual(lightTheme.radius);
    expect(darkTheme.fontSize).toEqual(lightTheme.fontSize);
    expect(darkTheme.fontFamily).toEqual(lightTheme.fontFamily);
    expect(darkTheme.fontWeight).toEqual(lightTheme.fontWeight);
    expect(darkTheme.lineHeight).toEqual(lightTheme.lineHeight);
    expect(darkTheme.transition).toEqual(lightTheme.transition);
    expect(darkTheme.zIndex).toEqual(lightTheme.zIndex);
    expect(darkTheme.breakpoint).toEqual(lightTheme.breakpoint);
    expect(darkTheme.size).toEqual(lightTheme.size);
  });
});
