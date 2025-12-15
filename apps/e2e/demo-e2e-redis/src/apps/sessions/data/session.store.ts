/**
 * In-memory session store that simulates Redis behavior
 * Used for E2E testing without requiring real Redis
 */

interface SessionEntry {
  value: string;
  expiresAt?: number;
}

class SessionStore {
  private data: Map<string, SessionEntry> = new Map();

  set(key: string, value: string, ttlSeconds?: number): void {
    const entry: SessionEntry = {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
    };
    this.data.set(key, entry);
  }

  get(key: string): string | null {
    const entry = this.data.get(key);
    if (!entry) return null;

    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.data.delete(key);
      return null;
    }

    return entry.value;
  }

  delete(key: string): boolean {
    return this.data.delete(key);
  }

  exists(key: string): boolean {
    const entry = this.data.get(key);
    if (!entry) return false;

    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.data.delete(key);
      return false;
    }

    return true;
  }

  keys(pattern?: string): string[] {
    const allKeys = Array.from(this.data.keys());
    if (!pattern) return allKeys;

    const regex = new RegExp(pattern.replace('*', '.*'));
    return allKeys.filter((k) => regex.test(k));
  }

  clear(): void {
    this.data.clear();
  }

  getAll(): Record<string, string> {
    const result: Record<string, string> = {};
    this.data.forEach((entry, key) => {
      if (!entry.expiresAt || Date.now() <= entry.expiresAt) {
        result[key] = entry.value;
      }
    });
    return result;
  }
}

// Global session store instance per session ID
const sessionStores: Map<string, SessionStore> = new Map();

export function getSessionStore(sessionId: string): SessionStore {
  let store = sessionStores.get(sessionId);
  if (!store) {
    store = new SessionStore();
    sessionStores.set(sessionId, store);
  }
  return store;
}

export function clearAllSessions(): void {
  sessionStores.clear();
}
