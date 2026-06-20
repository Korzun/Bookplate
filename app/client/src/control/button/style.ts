import { createUseStyles, type Theme } from '~/provider/theme';
import { applyTransparency } from '~/utils';

// A small handful of literals stay un-tokenized in this file by design:
//   '#e6e6e6' — loading-state border (one shade lighter than gray.200), button-only
//   '#f0f0f0' — text-button hover background, button-only
//   '#FFF'    — focus-ring border on colored backgrounds (intentional white-on-color)
//   '0.5em'   — gap that scales with the button's own font-size, not the rem scale
//   '0.80rem' — button-specific font-size, off the global fontSize scale

export type ButtonTypeValue = 'default' | 'primary' | 'text' | 'link' | 'dashed';
export enum ButtonType {
  Default = 'default',
  Primary = 'primary',
  Text = 'text',
  Link = 'link',
  Dashed = 'dashed',
}

export type ButtonRadiusValue = 'background' | 'card' | 'modal';
export enum ButtonRadius {
  Background = 'background',
  Card = 'card',
  Modal = 'modal',
}

export type StyleProps = {
  type: ButtonType;
  radius?: ButtonRadius;
};

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    display: 'flex',
    gap: '0.5em',
    justifyContent: 'center',
    alignItems: 'center',
    color: theme.color.gray[900],
    ...theme.recipe.focusRing,
    borderColor: 'transparent',
    borderStyle: 'solid',
    borderWidth: '1px',
    padding: `${theme.space.md} ${theme.space.xxl}`,
    cursor: 'pointer',
    fontSize: '0.80rem', // button-specific size; not on the global fontSize scale
    userSelect: 'none',
    '-webkit-user-select': 'none',
    '-webkit-tap-highlight-color': 'transparent',
    touchAction: 'manipulation',
    transitionProperty: 'color, background-color',
    transitionDuration: '0.1s',
    transitionTimingFunction: 'ease-in',
    '&:hover, &:focus, &:active': { transitionDuration: '0s' },
  },

  [ButtonRadius.Background]: {
    borderRadius: theme.radius.lg,
  },
  [ButtonRadius.Card]: {
    borderRadius: theme.radius.md,
  },
  [ButtonRadius.Modal]: {
    borderRadius: theme.radius.md,
  },

  [ButtonType.Default]: {
    backgroundColor: theme.color.bg.input,
    borderColor: theme.color.border.default,
    borderStyle: 'solid',
    borderWidth: '1px',
    boxShadow: theme.shadow.cardStack,
    color: theme.color.gray[900],
    '&:focus': {
      borderColor: '#FFF',
      outlineColor: theme.color.brand.outline,
      boxShadow: `0px 2px 0px transparent`,
    },
    '&:hover': {
      borderColor: theme.color.brand.hover,
      color: theme.color.brand.hover,
      outlineColor: 'transparent',
    },
    '&:active': {
      borderColor: theme.color.brand.active,
      color: theme.color.brand.active,
    },
    '&$disabled': {
      cursor: 'not-allowed',
      filter: 'saturate(0)',
      '&:hover': {
        borderColor: theme.color.border.default,
        color: theme.color.gray[900],
        outlineColor: 'transparent',
      },
    },
    '&$loading': {
      cursor: 'default',
      borderColor: '#e6e6e6',
      color: theme.color.text.muted,
      boxShadow: `0px 2px 0px transparent`,
      outlineColor: 'transparent',
      '&:focus': { borderColor: '#e6e6e6', color: theme.color.text.muted },
      '&:hover': { borderColor: theme.color.blue[300], color: theme.color.blue[300] },
      '&:active': {
        borderColor: theme.color.brand.loadingActive,
        color: theme.color.brand.loadingActive,
      },
      '&$disabled': { cursor: 'not-allowed', filter: 'saturate(0)' },
    },
    '&$danger': {
      color: theme.color.danger.default,
      borderColor: theme.color.danger.default,
      boxShadow: theme.shadow.dangerStack,
      '&:focus': {
        color: theme.color.danger.hover,
        borderColor: '#FFF',
        outlineColor: theme.color.danger.outline,
        boxShadow: `0px 2px 0px transparent`,
      },
      '&:hover': {
        color: applyTransparency(theme.color.danger.hover, 0.67),
        borderColor: applyTransparency(theme.color.danger.hover, 0.67),
        outlineColor: 'transparent',
      },
      '&:active': {
        color: theme.color.danger.active,
        borderColor: theme.color.danger.active,
      },
      '&$loading': {
        cursor: 'default',
        borderColor: theme.color.danger.hover,
        color: theme.color.danger.hover,
        outlineColor: 'transparent',
        boxShadow: `0px 2px 0px transparent`,
        '&:focus': { borderColor: theme.color.danger.hover, color: theme.color.danger.hover },
        '&:hover': {
          borderColor: theme.color.danger.loadingHover,
          color: theme.color.danger.loadingHover,
        },
        '&:active': {
          borderColor: theme.color.danger.loadingActive,
          color: theme.color.danger.loadingActive,
        },
      },
      '&$disabled': { cursor: 'not-allowed', filter: 'saturate(0)' },
    },
    '&$success': {
      color: theme.color.success,
      borderColor: '#bbf7d0',
      backgroundColor: '#f0fdf4',
      boxShadow: 'none',
      cursor: 'default',
      '&:hover': {
        color: theme.color.success,
        borderColor: '#bbf7d0',
        outlineColor: 'transparent',
      },
      '&:focus': {
        color: theme.color.success,
        borderColor: '#bbf7d0',
        outlineColor: 'transparent',
        boxShadow: 'none',
      },
      '&:active': { color: theme.color.success, borderColor: '#bbf7d0' },
    },
  },

  [ButtonType.Dashed]: {
    backgroundColor: theme.color.bg.input,
    borderColor: theme.color.border.default,
    borderStyle: 'dashed',
    borderWidth: '1px',
    color: theme.color.gray[900],
    '&:focus': {
      borderColor: '#FFF',
      outlineColor: theme.color.brand.outline,
    },
    '&:hover': {
      borderColor: theme.color.brand.hover,
      color: theme.color.brand.hover,
      outlineColor: 'transparent',
    },
    '&:active': {
      borderColor: theme.color.brand.active,
      color: theme.color.brand.active,
    },
    '&$disabled': {
      cursor: 'not-allowed',
      filter: 'saturate(0)',
      '&:hover': {
        borderColor: theme.color.border.default,
        color: theme.color.gray[900],
        outlineColor: 'transparent',
      },
    },
    '&$loading': {
      cursor: 'default',
      borderColor: '#e6e6e6',
      color: theme.color.text.muted,
      outlineColor: 'transparent',
      '&:focus': { borderColor: '#e6e6e6', color: theme.color.text.muted },
      '&:hover': { borderColor: theme.color.blue[300], color: theme.color.blue[300] },
      '&:active': {
        borderColor: theme.color.brand.loadingActive,
        color: theme.color.brand.loadingActive,
      },
      '&$disabled': { cursor: 'not-allowed', filter: 'saturate(0)' },
    },
    '&$danger': {
      color: theme.color.danger.default,
      borderColor: theme.color.danger.default,
      '&:focus': {
        color: theme.color.danger.hover,
        borderColor: '#FFF',
        outlineColor: theme.color.danger.outline,
      },
      '&:hover': {
        color: applyTransparency(theme.color.danger.hover, 0.67),
        borderColor: applyTransparency(theme.color.danger.hover, 0.67),
        outlineColor: 'transparent',
      },
      '&:active': {
        color: theme.color.danger.active,
        borderColor: theme.color.danger.active,
      },
      '&$loading': {
        cursor: 'default',
        borderColor: theme.color.danger.hover,
        color: theme.color.danger.hover,
        outlineColor: 'transparent',
        '&:focus': { borderColor: theme.color.danger.hover, color: theme.color.danger.hover },
        '&:hover': {
          borderColor: theme.color.danger.loadingHover,
          color: theme.color.danger.loadingHover,
        },
        '&:active': {
          borderColor: theme.color.danger.loadingActive,
          color: theme.color.danger.loadingActive,
        },
      },
      '&$disabled': { cursor: 'not-allowed', filter: 'saturate(0)' },
    },
  },

  [ButtonType.Primary]: {
    backgroundColor: theme.color.brand.default,
    boxShadow: theme.shadow.brandStack,
    color: theme.color.text.onPrimary,
    '&:focus': {
      backgroundColor: theme.color.brand.hover,
      borderColor: '#FFFFFF',
      outlineColor: applyTransparency(theme.color.brand.hover, 0.5),
      boxShadow: `0px 2px 0px transparent`,
    },
    '&:hover': {
      backgroundColor: theme.color.brand.hover,
      outlineColor: 'transparent',
      borderColor: 'transparent',
    },
    '&:active': {
      backgroundColor: theme.color.brand.active,
      outlineColor: 'transparent',
      borderColor: 'transparent',
    },
    '&$loading': {
      cursor: 'default',
      backgroundColor: theme.color.brand.loading,
      boxShadow: `0px 2px 0px transparent`,
      '&:focus': { outlineColor: 'transparent', borderColor: 'transparent' },
      '&:hover': { backgroundColor: theme.color.brand.loadingHover, outlineColor: 'transparent' },
      '&:active': { backgroundColor: theme.color.brand.loadingActive },
    },
    '&$disabled': { cursor: 'not-allowed', filter: 'saturate(0)' },
    '&$danger': {
      backgroundColor: theme.color.danger.default,
      boxShadow: theme.shadow.dangerStack,
      '&:focus': {
        backgroundColor: theme.color.danger.hover,
        borderColor: '#FFFFFF',
        outlineColor: theme.color.danger.outline,
        boxShadow: `0px 2px 0px transparent`,
      },
      '&:hover': {
        backgroundColor: theme.color.danger.hover,
        outlineColor: 'transparent',
        borderColor: 'transparent',
      },
      '&:active': {
        backgroundColor: theme.color.danger.active,
        outlineColor: 'transparent',
        borderColor: 'transparent',
      },
      '&$loading': {
        cursor: 'default',
        backgroundColor: theme.color.danger.loading,
        boxShadow: `0px 2px 0px transparent`,
        '&:hover': {
          backgroundColor: theme.color.danger.loadingHover,
          outlineColor: 'transparent',
        },
        '&:active': { backgroundColor: theme.color.danger.loadingActive },
        '&:focus': { outlineColor: 'transparent' },
      },
      '&$disabled': { cursor: 'not-allowed', filter: 'saturate(0)' },
    },
  },

  [ButtonType.Text]: {
    cursor: 'pointer',
    '&:hover': { backgroundColor: '#f0f0f0' },
    '&:active': { backgroundColor: theme.color.border.default },
    '&$disabled': {
      cursor: 'not-allowed',
      filter: 'saturate(0)',
      '&:hover': { backgroundColor: 'transparent' },
    },
    '&$loading': {
      cursor: 'default',
      color: theme.color.text.muted,
      '&:hover': { backgroundColor: '#f0f0f0' },
    },
    '&$danger': {
      color: theme.color.danger.default,
      '&:hover': { backgroundColor: theme.color.danger.light },
      '&$loading': {
        cursor: 'default',
        color: theme.color.danger.hover,
        '&:hover': { backgroundColor: theme.color.danger.light },
      },
    },
  },

  [ButtonType.Link]: {
    cursor: 'pointer',
    display: 'inline',
    borderStyle: 'none',
    outlineStyle: 'none',
    padding: '0',
    color: theme.color.brand.default,
    '&:hover': { color: theme.color.brand.hover },
    '&:active': { color: theme.color.brand.active },
    '&$disabled': {
      cursor: 'default',
      color: theme.color.text.muted,
    },
    '&$loading': {
      cursor: 'default',
      color: theme.color.text.muted,
      '&:hover': { color: theme.color.blue[300] },
      '&:active': { color: theme.color.brand.loadingActive },
    },
    '&$danger': {
      color: theme.color.danger.default,
      '&:hover': { color: theme.color.danger.hover },
      '&:active': { color: theme.color.danger.active },
      '&$loading': {
        cursor: 'default',
        color: theme.color.danger.loading,
        '&:hover': { color: theme.color.danger.loadingHover },
        '&:active': { color: theme.color.danger.loadingActive },
      },
    },
  },

  buttonIcon: {
    height: '1em',
    width: '1em',
    flexShrink: 0,
  },
  danger: {},
  disabled: { opacity: 0.5 },
  loading: {},
  success: {},
  spinner: {
    ...theme.recipe.spinner,
  },
}));
