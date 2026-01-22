// file: libs/sdk/src/skill/session/skill-session-store.interface.ts

import type { SkillSessionState } from './skill-session.types';

/**
 * Interface for skill session storage.
 * Implementations can store session state in memory, Redis, etc.
 */
export interface SkillSessionStore {
  /**
   * Save or update a session state.
   */
  save(session: SkillSessionState): Promise<void>;

  /**
   * Get a session state by ID.
   * Returns null if session doesn't exist.
   */
  get(sessionId: string): Promise<SkillSessionState | null>;

  /**
   * Update specific fields of a session.
   */
  update(sessionId: string, updates: Partial<SkillSessionState>): Promise<void>;

  /**
   * Delete a session.
   */
  delete(sessionId: string): Promise<void>;

  /**
   * List active sessions (sessions with an active skill).
   */
  listActive(options?: { limit?: number }): Promise<SkillSessionState[]>;

  /**
   * Clean up expired sessions.
   * @param maxAge - Maximum age in milliseconds
   */
  cleanup(maxAge: number): Promise<number>;

  /**
   * Store type identifier.
   */
  readonly type: 'memory' | 'redis' | 'custom';
}

/**
 * In-memory implementation of SkillSessionStore.
 * Suitable for single-instance deployments or testing.
 */
export class MemorySkillSessionStore implements SkillSessionStore {
  readonly type = 'memory' as const;
  private sessions = new Map<string, SkillSessionState>();

  async save(session: SkillSessionState): Promise<void> {
    // Clone the session to avoid reference issues
    this.sessions.set(session.sessionId, {
      ...session,
      allowedTools: new Set(session.allowedTools),
      requiredTools: new Set(session.requiredTools),
      approvedTools: new Set(session.approvedTools),
      deniedTools: new Set(session.deniedTools),
    });
  }

  async get(sessionId: string): Promise<SkillSessionState | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    // Return a clone
    return {
      ...session,
      allowedTools: new Set(session.allowedTools),
      requiredTools: new Set(session.requiredTools),
      approvedTools: new Set(session.approvedTools),
      deniedTools: new Set(session.deniedTools),
    };
  }

  async update(sessionId: string, updates: Partial<SkillSessionState>): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Deep-clone Set fields to avoid mutation issues
    const clonedUpdates = { ...updates };
    if (updates.allowedTools) {
      clonedUpdates.allowedTools = new Set(updates.allowedTools);
    }
    if (updates.requiredTools) {
      clonedUpdates.requiredTools = new Set(updates.requiredTools);
    }
    if (updates.approvedTools) {
      clonedUpdates.approvedTools = new Set(updates.approvedTools);
    }
    if (updates.deniedTools) {
      clonedUpdates.deniedTools = new Set(updates.deniedTools);
    }

    Object.assign(session, clonedUpdates);
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async listActive(options?: { limit?: number }): Promise<SkillSessionState[]> {
    const active: SkillSessionState[] = [];
    const limit = options?.limit ?? Infinity;

    for (const session of this.sessions.values()) {
      if (session.activeSkillId !== null) {
        active.push({
          ...session,
          allowedTools: new Set(session.allowedTools),
          requiredTools: new Set(session.requiredTools),
          approvedTools: new Set(session.approvedTools),
          deniedTools: new Set(session.deniedTools),
        });
        if (active.length >= limit) break;
      }
    }

    return active;
  }

  async cleanup(maxAge: number): Promise<number> {
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, session] of this.sessions) {
      // Clean up sessions that have been inactive
      if (session.startedAt > 0 && now - session.startedAt > maxAge) {
        this.sessions.delete(sessionId);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Clear all sessions. Useful for testing.
   */
  clear(): void {
    this.sessions.clear();
  }

  /**
   * Get the number of stored sessions.
   */
  size(): number {
    return this.sessions.size;
  }
}

/**
 * Factory function to create a skill session store.
 */
export function createSkillSessionStore(options?: {
  type?: 'memory' | 'redis';
  redis?: {
    host?: string;
    port?: number;
    keyPrefix?: string;
  };
}): SkillSessionStore {
  const type = options?.type ?? 'memory';

  switch (type) {
    case 'memory':
      return new MemorySkillSessionStore();

    case 'redis':
      // Redis implementation would go here
      // For now, fall back to memory
      console.warn('Redis skill session store not implemented, using memory store');
      return new MemorySkillSessionStore();

    default:
      return new MemorySkillSessionStore();
  }
}
