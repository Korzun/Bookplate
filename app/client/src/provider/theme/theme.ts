import { applyTransparency } from '~/utils';

export type ThemeMode = 'light' | 'dark';

// ─── Primitive palettes ───
const gray = {
  50: '#FCFCFC',
  100: '#EEEEEE',
  150: '#e5e7eb',
  200: '#DDDDDD',
  300: '#D9D9D9',
  400: '#D0D0D0',
  500: '#9ca3af',
  600: '#6E6E6E',
  700: '#5A6375',
  900: '#111',
} as const;

const blue = {
  50: '#EFF6FF',
  100: '#dbeafe',
  200: '#91CAFF',
  300: '#87BAFF',
  400: '#3696fe',
  500: '#1777FF',
  600: '#1D4ED8',
  700: '#0758d9',
  800: '#083FBC',
} as const;

const red = {
  50: '#fff1f0',
  100: '#FFA8A6',
  300: '#ff7874',
  400: '#FF8E8E',
  500: '#FF4D4F',
  600: '#e98182',
  700: '#D9373e',
} as const;

// JSS-spreadable style fragment. Loose by design: recipes nest pseudo-selectors
// (`&:hover`) and string/number CSS values, which a stricter type can't capture
// without inviting more friction than safety it would provide.
type Recipe = { [key: string]: Recipe | string | number };

// ─── Theme interface ───
export interface Theme {
  colorScheme: ThemeMode;
  color: {
    gray: typeof gray;
    blue: typeof blue;
    red: typeof red;
    text: {
      primary: string;
      secondary: string;
      muted: string;
      faint: string;
      onPrimary: string;
      onDanger: string;
      description: string;
    };
    bg: {
      page: string;
      card: string;
      cardHeader: string;
      input: string;
      footer: string;
      glass: string;
      glassFallback: string;
      glassActive: string;
      selected: string;
      hover: string;
      success: string;
      placeholder: string;
    };
    border: {
      default: string;
      strong: string;
      light: string;
      focus: string;
      hover: string;
      danger: string;
      glass: string;
      glassActive: string;
      faint: string;
      loading: string;
      success: string;
      section: string;
    };
    success: string;
    brand: {
      default: string;
      hover: string;
      active: string;
      light: string;
      outline: string;
      loading: string;
      loadingHover: string;
      loadingActive: string;
      linkHover: string;
    };
    danger: {
      default: string;
      hover: string;
      active: string;
      light: string;
      outline: string;
      loading: string;
      loadingHover: string;
      loadingActive: string;
    };
    overlay: { backdrop: string };
    chip: {
      status: { text: string; bg: string; border: string };
      author: { text: string; bg: string; border: string };
      series: { text: string; bg: string; border: string };
      subject: { text: string; bg: string; border: string };
      book: { text: string; bg: string; border: string };
      entryType: { text: string; bg: string; border: string };
    };
  };
  space: {
    xxxs: string;
    xxs: string;
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
    xxl: string;
    xxxl: string;
    xxxxl: string;
    xxxxxl: string;
  };
  radius: { sm: string; md: string; lg: string; circle: string; pill: string };
  size: { metadataValue: string };
  // Intrinsic sizes of chrome that other elements must lay out around. These are
  // measured, not derived (the element's real height comes from its content), so
  // they need on-device tuning — keep the single source of truth here.
  layout: { navHeightMobile: string };
  fontSize: {
    xxs: string;
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
    xxl: string;
  };
  fontFamily: { body: string; mono: string };
  fontWeight: { medium: number; semibold: number; bold: number; extrabold: number };
  lineHeight: { tight: number; body: number };
  shadow: {
    card: string;
    cardStack: string;
    hoverLift: string;
    dangerStack: string;
    brandStack: string;
    glass: string;
    glassActive: string;
  };
  transition: { fast: string; medium: string; slide: string; slow: string; spring: string };
  zIndex: {
    behind: number;
    base: number;
    stack: { lo: number; md: number; hi: number };
    header: number;
    sticky: number;
    toast: number;
  };
  breakpoint: {
    mobile: string;
    normal: string;
  };

  // Recipes are JSS-spreadable fragments. Loose typing lets them include
  // pseudo-selectors (`&:hover`) and nested rules without fighting JSS's TS surface.
  recipe: {
    input: Recipe;
    focusRing: Recipe;
    label: Recipe;
    spinner: Recipe;
    glass: Recipe;
    glassHighlight: Recipe;
    modal: {
      dialog: Recipe;
      header: Recipe;
      footer: Recipe;
    };
    card: {
      shell: Recipe;
      header: Recipe;
      footer: Recipe;
    };
  };
}

// ─── Build defaults ───
function buildTheme(mode: ThemeMode): Theme {
  const lightColor: Theme['color'] = {
    gray,
    blue,
    red,
    text: {
      primary: gray[900],
      secondary: gray[700],
      muted: gray[600],
      faint: gray[500],
      onPrimary: '#FFFFFF',
      onDanger: '#FFFFFF',
      description: '#585863',
    },
    bg: {
      page: '#F6F6F9',
      card: gray[50],
      cardHeader: gray[100],
      input: '#FFFFFF',
      footer: gray[100],
      glass: applyTransparency('#FFFFFF', 0.6),
      glassFallback: applyTransparency('#FFFFFF', 0.92),
      glassActive: applyTransparency('#FFFFFF', 0.55),
      selected: blue[100],
      hover: '#f0f0f0',
      success: '#f0fdf4',
      placeholder: '#d1d5db',
    },
    border: {
      default: gray[300],
      strong: gray[200],
      light: gray[150],
      focus: blue[700],
      hover: blue[200],
      danger: red[500],
      glass: applyTransparency('#000', 0.08),
      glassActive: applyTransparency('#FFFFFF', 0.7),
      faint: gray[500],
      loading: '#e6e6e6',
      success: '#bbf7d0',
      section: '#E6E6E9',
    },
    success: '#16a34a',
    brand: {
      default: blue[500],
      hover: blue[400],
      active: blue[700],
      light: blue[50],
      outline: blue[200],
      loading: '#73A6FF',
      loadingHover: blue[300],
      loadingActive: '#6893e7',
      linkHover: blue[300],
    },
    danger: {
      default: red[500],
      hover: red[300],
      active: red[700],
      light: red[50],
      outline: applyTransparency(red[300], 0.5),
      loading: red[400],
      loadingHover: red[100],
      loadingActive: red[600],
    },
    overlay: { backdrop: applyTransparency('#000', 0.7) },
    chip: {
      status: { text: '#6d3fc0', bg: 'rgba(109,63,192,0.08)', border: 'rgba(109,63,192,0.22)' },
      author: { text: '#1a7a52', bg: 'rgba(26,122,82,0.08)', border: 'rgba(26,122,82,0.22)' },
      series: { text: '#1a5fa8', bg: 'rgba(26,95,168,0.08)', border: 'rgba(26,95,168,0.22)' },
      subject: { text: '#8a5e00', bg: 'rgba(138,94,0,0.08)', border: 'rgba(138,94,0,0.22)' },
      book: { text: '#0e6b7d', bg: 'rgba(14, 107, 125, 0.08)', border: 'rgba(14, 107, 125, 0.22)' },
      entryType: {
        text: '#c0415e',
        bg: 'rgba(192, 65, 94, 0.08)',
        border: 'rgba(192, 65, 94, 0.22)',
      },
    },
  };

  const darkColor: Theme['color'] = {
    gray,
    blue,
    red,
    text: {
      primary: '#F5F5F7',
      secondary: '#C8CBD2',
      muted: '#9CA1AB',
      faint: '#6E7480',
      onPrimary: '#FFFFFF',
      onDanger: '#FFFFFF',
      description: '#A8ADB6',
    },
    bg: {
      page: '#242527',
      card: '#1A1B1E',
      cardHeader: '#232427',
      input: '#1A1B1E',
      footer: '#232427',
      glass: applyTransparency('#1C1C1E', 0.6),
      glassFallback: applyTransparency('#1C1C1E', 0.92),
      glassActive: applyTransparency('#2C2C2E', 0.55),
      selected: applyTransparency(blue[500], 0.24),
      hover: applyTransparency('#FFFFFF', 0.08),
      success: applyTransparency('#22C55E', 0.14),
      placeholder: '#2A2B2F',
    },
    border: {
      default: '#3A3B40',
      strong: '#48494F',
      light: '#2B2C30',
      faint: '#3A3B40',
      focus: blue[400],
      hover: blue[600],
      danger: red[500],
      glass: applyTransparency('#FFFFFF', 0.12),
      glassActive: applyTransparency('#FFFFFF', 0.18),
      loading: '#34353A',
      success: applyTransparency('#22C55E', 0.4),
      section: '#2B2C30',
    },
    success: '#22C55E',
    brand: {
      default: blue[400],
      hover: blue[300],
      active: blue[200],
      light: applyTransparency(blue[500], 0.2),
      outline: applyTransparency(blue[400], 0.45),
      linkHover: blue[200],
      loading: '#3E5A8A',
      loadingHover: blue[600],
      loadingActive: '#33507F',
    },
    danger: {
      default: red[500],
      hover: red[400],
      active: red[700],
      light: applyTransparency(red[500], 0.18),
      outline: applyTransparency(red[300], 0.5),
      loading: red[400],
      loadingHover: red[600],
      loadingActive: red[700],
    },
    overlay: { backdrop: applyTransparency('#000', 0.7) },
    chip: {
      status: { text: '#C9B0F2', bg: 'rgba(167,139,250,0.16)', border: 'rgba(167,139,250,0.30)' },
      author: { text: '#7EE6B4', bg: 'rgba(52,211,153,0.16)', border: 'rgba(52,211,153,0.30)' },
      series: { text: '#8EC3F5', bg: 'rgba(96,165,250,0.16)', border: 'rgba(96,165,250,0.30)' },
      subject: { text: '#E8C879', bg: 'rgba(217,168,67,0.16)', border: 'rgba(217,168,67,0.30)' },
      book: { text: '#7FD0DE', bg: 'rgba(45, 170, 190, 0.18)', border: 'rgba(45, 170, 190, 0.32)' },
      entryType: {
        text: '#E89BAC',
        bg: 'rgba(192, 65, 94, 0.18)',
        border: 'rgba(192, 65, 94, 0.32)',
      },
    },
  };

  const color: Theme['color'] = mode === 'dark' ? darkColor : lightColor;

  const space: Theme['space'] = {
    xxxs: '0.1rem',
    xxs: '0.125rem',
    xs: '0.25rem',
    sm: '0.375rem',
    md: '0.5rem',
    lg: '0.625rem',
    xl: '0.75rem',
    xxl: '1rem',
    xxxl: '1.25rem',
    xxxxl: '1.5rem',
    xxxxxl: '2rem',
  };

  const radius: Theme['radius'] = {
    sm: '4px',
    md: '8px',
    lg: '16px',
    circle: '50%',
    pill: '999px',
  };
  const size: Theme['size'] = { metadataValue: '15rem' };
  // The floating mobile nav capsule is ~96px tall on-device (content + padding +
  // the min bottom floor). Tune against the measured height during on-device
  // verification; page padding and bottom-docked toasts both clear it via this token.
  const layout: Theme['layout'] = { navHeightMobile: '96px' };
  const fontSize: Theme['fontSize'] = {
    xxs: '0.6rem',
    xs: '0.7rem',
    sm: '0.75rem',
    md: '0.875rem',
    lg: '1rem',
    xl: '1.25rem',
    xxl: '1.75rem',
  };
  const fontFamily: Theme['fontFamily'] = {
    body: 'system-ui, sans-serif',
    mono: "'Cascadia Code', 'Fira Code', monospace",
  };
  const fontWeight: Theme['fontWeight'] = { medium: 500, semibold: 600, bold: 700, extrabold: 800 };
  const lineHeight: Theme['lineHeight'] = { tight: 1, body: 1.3 };

  const lightShadow: Theme['shadow'] = {
    card: '0 1px 3px rgba(0,0,0,0.07)',
    cardStack: `0px 2px 0px ${applyTransparency('#D9D9D9', 0.2)}`,
    hoverLift: '0 2px 8px rgba(0,0,0,0.15)',
    dangerStack: `0px 2px 0px ${applyTransparency('#FF4D4F', 0.1)}`,
    brandStack: `0px 2px 0px ${applyTransparency('#1777FF', 0.2)}`,
    glass: `0 8px 32px ${applyTransparency('#000', 0.12)}`,
    glassActive: `0 2px 6px ${applyTransparency('#000', 0.12)}`,
  };

  const darkShadow: Theme['shadow'] = {
    card: '0 1px 3px rgba(0,0,0,0.5)',
    cardStack: `0px 2px 0px ${applyTransparency('#000', 0.4)}`,
    hoverLift: '0 2px 8px rgba(0,0,0,0.6)',
    dangerStack: `0px 2px 0px ${applyTransparency('#000', 0.4)}`,
    brandStack: `0px 2px 0px ${applyTransparency('#000', 0.4)}`,
    glass: `0 8px 32px ${applyTransparency('#000', 0.5)}`,
    glassActive: `0 2px 6px ${applyTransparency('#000', 0.5)}`,
  };

  const shadow: Theme['shadow'] = mode === 'dark' ? darkShadow : lightShadow;

  const transition: Theme['transition'] = {
    fast: '0.1s ease-in',
    medium: '0.2s ease-in',
    slide: '0.2s ease-out',
    slow: '0.3s linear',
    spring: '0.35s cubic-bezier(0.4, 0, 0.2, 1)',
  };

  const zIndex: Theme['zIndex'] = {
    behind: -1,
    base: 1,
    stack: { lo: 1, md: 2, hi: 3 },
    header: 10,
    sticky: 1000,
    toast: 9999,
  };

  const breakpoint: Theme['breakpoint'] = {
    mobile: '@media (max-width: 640px)',
    normal: '@media (min-width: 641px)',
  };

  const recipe: Theme['recipe'] = {
    input: {
      fontFamily: fontFamily.body,
      outlineWidth: '2px',
      outlineStyle: 'solid',
      outlineColor: 'transparent',
      backgroundColor: color.bg.input,
      borderColor: color.border.default,
      borderStyle: 'solid',
      borderWidth: '1px',
      borderRadius: radius.md,
      padding: space.md,
      '-webkit-appearance': 'none',
      '&:hover': { borderColor: color.border.hover },
      '&:focus': { borderColor: color.border.focus },
      '&$danger': { borderColor: color.border.danger },
    },
    focusRing: {
      outlineWidth: '2px',
      outlineStyle: 'solid',
      outlineColor: 'transparent',
    },
    label: {
      fontWeight: fontWeight.semibold,
      fontSize: fontSize.md,
      color: color.text.muted,
      display: 'block',
      '&$danger': { color: color.danger.default },
    },
    spinner: {
      animation: 'theme-rotation 1s infinite linear',
      height: '1em',
      width: '1em',
    },
    glass: {
      backgroundColor: color.bg.glass,
      backdropFilter: 'blur(20px) saturate(180%)',
      '-webkit-backdrop-filter': 'blur(20px) saturate(180%)',
      borderStyle: 'solid',
      borderWidth: '1px',
      borderColor: color.border.glass,
      boxShadow: shadow.glass,
      '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))': {
        backgroundColor: color.bg.glassFallback,
      },
    },
    glassHighlight: {
      backgroundColor: color.bg.glassActive,
      borderStyle: 'solid',
      borderWidth: '1px',
      borderColor: color.border.glassActive,
      boxShadow: shadow.glassActive,
    },
    modal: {
      dialog: {
        cursor: 'default',
        fontFamily: fontFamily.body,
        fontSize: fontSize.lg,
        fontStyle: 'normal',
        letterSpacing: 'normal',
        lineHeight: lineHeight.body,
        textTransform: 'none',
        wordBreak: 'normal',
        overflowWrap: 'break-word',
        borderRadius: radius.lg,
        border: 'none',
        padding: 0,
        overflow: 'hidden',
        maxWidth: `calc(100vw - ${space.xxl} * 2)`,
        marginTop: '100px',
        marginLeft: 'auto',
        marginRight: 'auto',
        marginBottom: '50px',
        outline: 'none',
        '&::backdrop': {
          backgroundColor: color.overlay.backdrop,
          backdropFilter: 'blur(2px) saturate(0%)',
        },
        [breakpoint.mobile]: {
          marginTop: `calc(${space.xxxxxl} + env(safe-area-inset-top))`,
          marginBottom: `calc(${space.xxxxxl} + env(safe-area-inset-bottom))`,
          maxHeight: `calc(100dvh - ${space.xxxxxl} * 2 - env(safe-area-inset-top) - env(safe-area-inset-bottom))`,
          overflowY: 'auto',
        },
      },
      header: {
        fontWeight: fontWeight.semibold,
        fontSize: fontSize.xl,
        padding: space.xxl,
      },
      footer: {
        backgroundColor: color.bg.footer,
        borderTopStyle: 'solid',
        borderTopColor: color.border.strong,
        borderTopWidth: '1px',
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'end',
        gap: space.md,
        paddingTop: space.xl,
        paddingBottom: space.xl,
        paddingLeft: space.xl,
        paddingRight: space.xl,
      },
    },
    card: {
      shell: {
        backgroundColor: color.bg.card,
        borderRadius: radius.lg,
        borderStyle: 'solid',
        borderWidth: '1px',
        borderColor: color.border.strong,
        overflow: 'hidden',
        boxShadow: shadow.cardStack,
      },
      header: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: `${space.md} ${space.xl}`,
        backgroundColor: color.bg.cardHeader,
        borderBottomStyle: 'solid',
        borderBottomWidth: '1px',
        borderBottomColor: color.border.strong,
        userSelect: 'none',
        '-webkit-user-select': 'none',
      },
      footer: {
        backgroundColor: color.bg.footer,
        borderTopStyle: 'solid',
        borderTopColor: color.border.strong,
        borderTopWidth: '1px',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'end',
        gap: space.md,
        paddingTop: space.xl,
        paddingBottom: space.xl,
        paddingLeft: space.xl,
        paddingRight: space.xl,
      },
    },
  };

  return {
    colorScheme: mode,
    color,
    space,
    radius,
    size,
    layout,
    fontSize,
    fontFamily,
    fontWeight,
    lineHeight,
    shadow,
    transition,
    zIndex,
    breakpoint,
    recipe,
  };
}

export const lightTheme: Theme = buildTheme('light');
export const darkTheme: Theme = buildTheme('dark');
export const defaultTheme: Theme = lightTheme;
