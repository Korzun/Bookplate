import '@testing-library/jest-dom';

// Node.js 22+ ships a built-in localStorage that requires --localstorage-file to work.
// Vitest skips jsdom's working implementation because the key already exists on the Node
// global, leaving the broken built-in in place. Replace it with an in-memory store so
// tests can use localStorage normally.
const createInMemoryStorage = () => {
  let store: Record<string, string> = {};
  return {
    get length() {
      return Object.keys(store).length;
    },
    key: (n: number) => Object.keys(store)[n] ?? null,
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
};

Object.defineProperty(globalThis, 'localStorage', {
  value: createInMemoryStorage(),
  writable: true,
  configurable: true,
});
