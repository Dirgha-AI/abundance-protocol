/**
 * Simple promise-based key-value store
 * In production, replace with Redis or database
 */
const store: Map<string, string> = new Map();

export const promises = {
  get: async (key: string): Promise<string | null> => {
    return store.get(key) || null;
  },
  set: async (key: string, value: string): Promise<void> => {
    store.set(key, value);
  },
  del: async (key: string): Promise<void> => {
    store.delete(key);
  },
};
