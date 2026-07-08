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

describe('new semantic tokens — light values are byte-identical to replaced literals', () => {
  it('bg.hover light equals #f0f0f0', () => {
    expect(lightTheme.color.bg.hover).toBe('#f0f0f0');
  });
  it('bg.success light equals #f0fdf4', () => {
    expect(lightTheme.color.bg.success).toBe('#f0fdf4');
  });
  it('bg.placeholder light equals #d1d5db', () => {
    expect(lightTheme.color.bg.placeholder).toBe('#d1d5db');
  });
  it('border.loading light equals #e6e6e6', () => {
    expect(lightTheme.color.border.loading).toBe('#e6e6e6');
  });
  it('border.success light equals #bbf7d0', () => {
    expect(lightTheme.color.border.success).toBe('#bbf7d0');
  });
  it('border.section light equals #E6E6E9', () => {
    expect(lightTheme.color.border.section).toBe('#E6E6E9');
  });
  it('text.description light equals #585863', () => {
    expect(lightTheme.color.text.description).toBe('#585863');
  });
  it('chip.book light values match replaced literals', () => {
    expect(lightTheme.color.chip.book.text).toBe('#0e6b7d');
    expect(lightTheme.color.chip.book.bg).toBe('rgba(14, 107, 125, 0.08)');
    expect(lightTheme.color.chip.book.border).toBe('rgba(14, 107, 125, 0.22)');
  });
  it('chip.entryType light values match replaced literals', () => {
    expect(lightTheme.color.chip.entryType.text).toBe('#c0415e');
    expect(lightTheme.color.chip.entryType.bg).toBe('rgba(192, 65, 94, 0.08)');
    expect(lightTheme.color.chip.entryType.border).toBe('rgba(192, 65, 94, 0.22)');
  });
});

describe('new semantic tokens — dark values exist and differ from light', () => {
  it('bg.hover dark differs from light', () => {
    expect(darkTheme.color.bg.hover).toBeDefined();
    expect(darkTheme.color.bg.hover).not.toBe(lightTheme.color.bg.hover);
  });
  it('bg.success dark differs from light', () => {
    expect(darkTheme.color.bg.success).toBeDefined();
    expect(darkTheme.color.bg.success).not.toBe(lightTheme.color.bg.success);
  });
  it('bg.placeholder dark differs from light', () => {
    expect(darkTheme.color.bg.placeholder).toBeDefined();
    expect(darkTheme.color.bg.placeholder).not.toBe(lightTheme.color.bg.placeholder);
  });
  it('border.loading dark differs from light', () => {
    expect(darkTheme.color.border.loading).toBeDefined();
    expect(darkTheme.color.border.loading).not.toBe(lightTheme.color.border.loading);
  });
  it('border.success dark differs from light', () => {
    expect(darkTheme.color.border.success).toBeDefined();
    expect(darkTheme.color.border.success).not.toBe(lightTheme.color.border.success);
  });
  it('border.section dark differs from light', () => {
    expect(darkTheme.color.border.section).toBeDefined();
    expect(darkTheme.color.border.section).not.toBe(lightTheme.color.border.section);
  });
  it('text.description dark differs from light', () => {
    expect(darkTheme.color.text.description).toBeDefined();
    expect(darkTheme.color.text.description).not.toBe(lightTheme.color.text.description);
  });
  it('chip.book dark differs from light', () => {
    expect(darkTheme.color.chip.book.text).not.toBe(lightTheme.color.chip.book.text);
    expect(darkTheme.color.chip.book.bg).not.toBe(lightTheme.color.chip.book.bg);
    expect(darkTheme.color.chip.book.border).not.toBe(lightTheme.color.chip.book.border);
  });
  it('chip.entryType dark differs from light', () => {
    expect(darkTheme.color.chip.entryType.text).not.toBe(lightTheme.color.chip.entryType.text);
    expect(darkTheme.color.chip.entryType.bg).not.toBe(lightTheme.color.chip.entryType.bg);
    expect(darkTheme.color.chip.entryType.border).not.toBe(lightTheme.color.chip.entryType.border);
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

describe('bg.page flat noise-average (noise textures removed)', () => {
  it('dark bg.page is the flat charcoal average', () => {
    expect(darkTheme.color.bg.page).toBe('#242527');
  });
  it('light bg.page is the lightened off-white', () => {
    expect(lightTheme.color.bg.page).toBe('#F6F6F9');
  });
});
