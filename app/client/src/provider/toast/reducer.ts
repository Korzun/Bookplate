export type ToastEntry = {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
  isDismissing: boolean;
};

export type ToastAction =
  | {
      type: 'add';
      id: number;
      message: string;
      toastType: 'success' | 'error' | 'info';
      maxToasts: number;
    }
  | { type: 'dismiss'; id: number }
  | { type: 'remove'; id: number };

export function toastReducer(state: ToastEntry[], action: ToastAction): ToastEntry[] {
  switch (action.type) {
    case 'add': {
      const next: ToastEntry = {
        id: action.id,
        message: action.message,
        type: action.toastType,
        isDismissing: false,
      };
      if (state.length >= action.maxToasts) {
        const base = state[0]?.isDismissing
          ? state.slice(1)
          : state.map((t, i) => (i === 0 ? { ...t, isDismissing: true } : t));
        return [...base, next];
      }
      return [...state, next];
    }
    case 'dismiss':
      return state.map((t) => (t.id === action.id ? { ...t, isDismissing: true } : t));
    case 'remove':
      return state.filter((t) => t.id !== action.id);
  }
}
