// crypto.randomUUID() requires a secure context (HTTPS). Home Assistant is often
// served over HTTP on the local network, so we fall back to getRandomValues or Math.random.
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => {
      const n = Number(c);
      return (n ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (n / 4)))).toString(16);
    });
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// navigator.clipboard requires a secure context (HTTPS). Home Assistant is often
// served over HTTP on the local network, so we fall back to a temporary textarea
// and the legacy execCommand('copy'). Returns whether the copy succeeded.
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the legacy path (e.g. permission denied, not focused)
    }
  }

  if (typeof document === 'undefined') return false;

  const textarea = document.createElement('textarea');
  textarea.value = text;
  // Keep it out of view and prevent scrolling/zoom side effects.
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.setAttribute('readonly', '');
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function relativeTime(timestamp: number): string {
  const diff = Math.floor(Date.now() / 1000) - timestamp;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export const formatTimestamp = (milliseconds: number | undefined): string[] => {
  if (milliseconds === undefined) {
    return [];
  }
  const date = new Date(milliseconds);
  return [
    date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
    date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
  ];
};

export function applyTransparency(color: string, alpha: number): string {
  // Clamp alpha between 0 and 1
  const clampedAlpha = Math.min(1, Math.max(0, alpha));

  // Match hex: #RGB, #RGBA, #RRGGBB, #RRGGBBAA
  const hexMatch = color.match(/^#([0-9a-fA-F]{3,8})$/);
  if (hexMatch) {
    let hex = hexMatch[1];

    // Expand shorthand #RGB or #RGBA to full form
    if (hex.length === 3 || hex.length === 4) {
      hex = hex
        .split('')
        .map((c) => c + c)
        .join('');
    }

    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);

    // If already has alpha (#RRGGBBAA), use it; otherwise default to 1
    const existingAlpha = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    const finalAlpha = existingAlpha < 1 ? existingAlpha : clampedAlpha;

    return `rgba(${r}, ${g}, ${b}, ${finalAlpha})`;
  }

  // Match rgb(R, G, B) or rgba(R, G, B, A)
  const rgbMatch = color.match(/^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1]);
    const g = parseInt(rgbMatch[2]);
    const b = parseInt(rgbMatch[3]);
    const existingAlpha = rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1;
    const finalAlpha = existingAlpha < 1 ? existingAlpha : clampedAlpha;

    return `rgba(${r}, ${g}, ${b}, ${finalAlpha})`;
  }

  throw new Error(`Unsupported color format: "${color}"`);
}

export const areObjectArraysIdentical = <T extends Record<string, unknown>>(
  arrayA: T[],
  arrayB: T[]
): boolean => {
  if (arrayA === arrayB) return true;
  if (arrayA == null || arrayB == null) return false;
  if (arrayA.length !== arrayB.length) return false;

  const serialize = (obj: T) => JSON.stringify(obj, Object.keys(obj).sort());
  const sortedA = [...arrayA].map(serialize).sort();
  const sortedB = [...arrayB].map(serialize).sort();

  for (let index = 0; index < sortedA.length; ++index) {
    if (sortedA[index] !== sortedB[index]) return false;
  }
  return true;
};

export const areStringArraysIdentical = (arrayA: string[], arrayB: string[]): boolean => {
  if (arrayA === arrayB) return true;
  if (arrayA == null || arrayB == null) return false;
  if (arrayA.length !== arrayB.length) return false;

  const sortedArrayA = [...arrayA].sort((stringA, stringB) => stringA.localeCompare(stringB));
  const sortedArrayB = [...arrayB].sort((stringA, stringB) => stringA.localeCompare(stringB));

  for (let index = 0; index < sortedArrayA.length; ++index) {
    if (sortedArrayA[index] !== sortedArrayB[index]) return false;
  }
  return true;
};

export const hashString = (str: string, seed = 0) => {
  let h1 = 0xdeadbeef ^ seed,
    h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
};

export const isNumeric = (value: string) =>
  typeof value !== 'string'
    ? false
    : !isNaN(value as unknown as number) && !isNaN(parseFloat(value));

export const depluralize = (str: string): string => {
  if (str.endsWith('ies')) return str.slice(0, -3) + 'y';
  if (str.endsWith('ves')) return str.slice(0, -3) + 'f';
  if (
    str.endsWith('ses') ||
    str.endsWith('xes') ||
    str.endsWith('zes') ||
    str.endsWith('ches') ||
    str.endsWith('shes')
  )
    return str.slice(0, -2);
  if (str.endsWith('s') && !str.endsWith('ss')) return str.slice(0, -1);
  return str;
};
