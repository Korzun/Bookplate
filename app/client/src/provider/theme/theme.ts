import { applyTransparency } from '~/utils';

// ─── Primitive palettes ───
const gray = {
  50: '#FAFAFA',
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
    };
    bg: { page: string; card: string; cardHeader: string; input: string; footer: string };
    border: {
      default: string;
      strong: string;
      light: string;
      focus: string;
      hover: string;
      danger: string;
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
  radius: { sm: string; md: string; lg: string; circle: string };
  size: { metadataValue: string };
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
  };
  transition: { fast: string; slide: string; slow: string };
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
    modal: {
      dialog: Recipe;
      header: Recipe;
      footer: Recipe;
    };
    card: {
      shell: Recipe;
      header: Recipe;
    };
  };
}

// ─── Build defaults ───
function buildTheme(): Theme {
  const color: Theme['color'] = {
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
    },
    bg: {
      page: '#FFFFFF',
      card: gray[50],
      cardHeader: gray[100],
      input: '#FFFFFF',
      footer: gray[100],
    },
    border: {
      default: gray[300],
      strong: gray[200],
      light: gray[150],
      focus: blue[700],
      hover: blue[200],
      danger: red[500],
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
  };

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

  const radius: Theme['radius'] = { sm: '4px', md: '8px', lg: '16px', circle: '50%' };
  const size: Theme['size'] = { metadataValue: '15rem' };
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

  const shadow: Theme['shadow'] = {
    card: '0 1px 3px rgba(0,0,0,0.07)',
    cardStack: `0px 2px 0px ${applyTransparency('#D9D9D9', 0.2)}`,
    hoverLift: '0 2px 8px rgba(0,0,0,0.15)',
    dangerStack: `0px 2px 0px ${applyTransparency('#FF4D4F', 0.1)}`,
    brandStack: `0px 2px 0px ${applyTransparency('#1777FF', 0.2)}`,
  };

  const transition: Theme['transition'] = {
    fast: '0.1s ease-in',
    slide: '0.2s ease-out',
    slow: '0.3s linear',
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
        alignItems: 'baseline',
        justifyContent: 'space-between',
        padding: `${space.md} ${space.xl}`,
        backgroundColor: color.bg.cardHeader,
        borderBottomStyle: 'solid',
        borderBottomWidth: '1px',
        borderBottomColor: color.border.strong,
        userSelect: 'none',
        '-webkit-user-select': 'none',
      },
    },
  };

  return {
    color,
    space,
    radius,
    size,
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

export const defaultTheme: Theme = buildTheme();
