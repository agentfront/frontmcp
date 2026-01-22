// file: libs/sdk/src/skill/session/skill-session.manager.ts

import { AsyncLocalStorage } from 'async_hooks';
import { EventEmitter } from 'events';
import type { FrontMcpLogger } from '../../common';
import type { SkillContent } from '../../common/interfaces';
import type { SkillLoadResult } from '../skill-storage.interface';
import {
  SkillSessionState,
  SkillSessionOptions,
  SkillActivationResult,
  ToolAuthorizationResult,
  SkillSessionEvent,
  SkillSecurityPolicy,
  SkillPolicyMode,
  ActiveSkillInfo,
  createEmptySessionState,
} from './skill-session.types';
import type { SkillSessionStore } from './skill-session-store.interface';

/**
 * Manages skill session state and tool authorization.
 *
 * Uses AsyncLocalStorage to track the active skill session per request context.
 * This ensures that tool authorization checks are isolated per MCP session.
 *
 * @example
 * ```typescript
 * const manager = new SkillSessionManager({ defaultPolicyMode: 'strict' });
 *
 * // When loading a skill
 * const result = manager.activateSkill('review-pr', skillContent, loadResult);
 *
 * // When calling a tool
 * const authResult = manager.checkToolAuthorization('github_get_pr');
 * if (!authResult.allowed) {
 *   throw new ToolNotAllowedError(authResult);
 * }
 *
 * // When done with the skill
 * manager.deactivateSkill();
 * ```
 */
export class SkillSessionManager extends EventEmitter {
  private readonly storage = new AsyncLocalStorage<SkillSessionState>();
  private readonly options: Required<SkillSessionOptions>;
  private readonly logger?: FrontMcpLogger;
  private readonly store?: SkillSessionStore;

  constructor(options?: SkillSessionOptions, logger?: FrontMcpLogger, store?: SkillSessionStore) {
    super();
    this.options = {
      defaultPolicyMode: options?.defaultPolicyMode ?? 'permissive',
      requireExplicitActivation: options?.requireExplicitActivation ?? false,
      trackToolUsage: options?.trackToolUsage ?? true,
      maxToolCallsPerSession: options?.maxToolCallsPerSession ?? 0,
      maxSessionDuration: options?.maxSessionDuration ?? 0,
    };
    this.logger = logger;
    this.store = store;
  }

  /**
   * Run a function within a skill session context.
   * The session state will be available via getActiveSession() within the callback.
   */
  async runWithSession<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    // Try to restore existing session from store
    let state: SkillSessionState | undefined;
    if (this.store) {
      const stored = await this.store.get(sessionId);
      if (stored) {
        state = stored;
      }
    }

    // Create new empty session if none exists
    if (!state) {
      state = createEmptySessionState(sessionId, this.options);
    }

    return this.storage.run(state, fn);
  }

  /**
   * Get the current session state.
   * Returns undefined if not running within a session context.
   */
  getActiveSession(): SkillSessionState | undefined {
    return this.storage.getStore();
  }

  /**
   * Check if there's an active skill in the current session.
   */
  hasActiveSkill(): boolean {
    const session = this.getActiveSession();
    if (!session) return false;
    return session.activeSkills.size > 0;
  }

  /**
   * Get the number of active skills in the current session.
   */
  getActiveSkillCount(): number {
    const session = this.getActiveSession();
    return session?.activeSkills.size ?? 0;
  }

  /**
   * Get IDs of all active skills in the current session.
   */
  getActiveSkillIds(): string[] {
    const session = this.getActiveSession();
    if (!session) return [];
    return Array.from(session.activeSkills.keys());
  }

  /**
   * Get names of all active skills in the current session.
   */
  getActiveSkillNames(): string[] {
    const session = this.getActiveSession();
    if (!session) return [];
    return Array.from(session.activeSkills.values()).map((s) => s.name);
  }

  /**
   * Activate a skill in the current session.
   * This adds the skill to the active skills and expands the tool allowlist.
   * Multiple skills can be active simultaneously, with their tool allowlists combined.
   *
   * @param skillId - The skill identifier
   * @param skillContent - The loaded skill content
   * @param loadResult - The skill load result with tool availability info
   * @param policy - Optional security policy override
   * @returns Activation result with session state and tool availability
   */
  activateSkill(
    skillId: string,
    skillContent: SkillContent,
    loadResult: SkillLoadResult,
    policy?: SkillSecurityPolicy,
  ): SkillActivationResult {
    const session = this.getActiveSession();
    if (!session) {
      throw new Error('Cannot activate skill: not running within a session context');
    }

    // Extract tool names from skill content
    const toolNames = skillContent.tools.map((t) => t.name);
    // Extract required tools - tools marked with required: true in skill metadata
    const requiredToolNames = skillContent.tools.filter((t) => t.required === true).map((t) => t.name);

    const now = Date.now();

    // Create skill info for this activation
    const skillInfo: ActiveSkillInfo = {
      id: skillId,
      name: skillContent.name,
      allowedTools: new Set(toolNames),
      requiredTools: new Set(requiredToolNames),
      activatedAt: now,
    };

    // Add to active skills (replaces if same skillId already active)
    session.activeSkills.set(skillId, skillInfo);

    // Update "most recent" skill pointers
    session.activeSkillId = skillId;
    session.activeSkillName = skillContent.name;

    // Rebuild combined allowedTools and requiredTools from all active skills
    this.rebuildCombinedToolSets(session);

    // Update policy mode (use provided or keep existing if skills already active)
    if (policy?.policyMode) {
      session.policyMode = policy.policyMode;
    } else if (session.activeSkills.size === 1) {
      // First skill activation - set policy from options
      session.policyMode = this.options.defaultPolicyMode;
    }

    // Set startedAt for first skill activation
    if (session.startedAt === 0) {
      session.startedAt = now;
    }

    // Persist to store if available
    this.persistSession(session);

    // Emit activation event
    this.emitSessionEvent({
      type: 'activated',
      sessionId: session.sessionId,
      skillId,
      timestamp: now,
      data: {
        allowedTools: toolNames,
        totalAllowedTools: Array.from(session.allowedTools),
        activeSkillCount: session.activeSkills.size,
        policyMode: session.policyMode,
      },
    });

    this.logger?.debug(`Skill session activated: ${skillId}`, {
      sessionId: session.sessionId,
      skillToolsAdded: toolNames,
      totalAllowedTools: session.allowedTools.size,
      activeSkillCount: session.activeSkills.size,
      policyMode: session.policyMode,
    });

    return {
      session,
      availableTools: loadResult.availableTools,
      missingTools: loadResult.missingTools,
      isComplete: loadResult.isComplete,
      warning: loadResult.warning,
    };
  }

  /**
   * Rebuild the combined allowedTools and requiredTools sets from all active skills.
   */
  private rebuildCombinedToolSets(session: SkillSessionState): void {
    session.allowedTools.clear();
    session.requiredTools.clear();

    for (const skill of session.activeSkills.values()) {
      for (const tool of skill.allowedTools) {
        session.allowedTools.add(tool);
      }
      for (const tool of skill.requiredTools) {
        session.requiredTools.add(tool);
      }
    }
  }

  /**
   * Deactivate a skill or all skills in the current session.
   *
   * @param skillId - Optional skill ID to deactivate. If not provided, deactivates all skills.
   */
  deactivateSkill(skillId?: string): void {
    const session = this.getActiveSession();
    if (!session || session.activeSkills.size === 0) {
      return;
    }

    const now = Date.now();
    const duration = session.startedAt > 0 ? now - session.startedAt : 0;

    if (skillId) {
      // Deactivate specific skill
      const skill = session.activeSkills.get(skillId);
      if (!skill) {
        return; // Skill not active, nothing to do
      }

      session.activeSkills.delete(skillId);

      // Emit deactivation event for this skill
      this.emitSessionEvent({
        type: 'deactivated',
        sessionId: session.sessionId,
        skillId,
        timestamp: now,
        data: {
          skillName: skill.name,
          remainingSkills: session.activeSkills.size,
        },
      });

      this.logger?.debug(`Skill deactivated: ${skillId}`, {
        sessionId: session.sessionId,
        remainingSkills: session.activeSkills.size,
      });

      // Rebuild combined tool sets from remaining skills
      this.rebuildCombinedToolSets(session);

      // Update "most recent" pointers
      if (session.activeSkills.size > 0) {
        // Find the most recently activated remaining skill
        let mostRecent: ActiveSkillInfo | null = null;
        for (const s of session.activeSkills.values()) {
          if (!mostRecent || s.activatedAt > mostRecent.activatedAt) {
            mostRecent = s;
          }
        }
        if (mostRecent) {
          session.activeSkillId = mostRecent.id;
          session.activeSkillName = mostRecent.name;
        }
      } else {
        // No skills remaining, clear everything
        this.clearSessionState(session, duration, now);
      }
    } else {
      // Deactivate all skills
      const skillIds = Array.from(session.activeSkills.keys());

      // Emit deactivation events for each skill
      for (const [id, skill] of session.activeSkills) {
        this.emitSessionEvent({
          type: 'deactivated',
          sessionId: session.sessionId,
          skillId: id,
          timestamp: now,
          data: {
            skillName: skill.name,
            duration,
            toolCallCount: session.toolCallCount,
          },
        });
      }

      this.logger?.debug(`All skills deactivated`, {
        sessionId: session.sessionId,
        deactivatedSkills: skillIds,
        duration,
        toolCallCount: session.toolCallCount,
      });

      // Clear all session state
      this.clearSessionState(session, duration, now);
    }

    // Persist to store if available
    this.persistSession(session);
  }

  /**
   * Clear all session state (called when no skills remain active).
   */
  private clearSessionState(session: SkillSessionState, _duration: number, _timestamp: number): void {
    session.activeSkillId = null;
    session.activeSkillName = null;
    session.activeSkills.clear();
    session.allowedTools.clear();
    session.requiredTools.clear();
    session.startedAt = 0;
    session.approvedTools.clear();
    session.deniedTools.clear();
    session.toolCallCount = 0;
  }

  /**
   * Check if a tool is authorized in the current session.
   * Returns detailed authorization result including reason.
   *
   * @param toolName - The name of the tool to check
   * @returns Authorization result
   */
  checkToolAuthorization(toolName: string): ToolAuthorizationResult {
    const session = this.getActiveSession();

    // No session context - default allow (unless requireExplicitActivation)
    if (!session) {
      if (this.options.requireExplicitActivation) {
        return {
          allowed: false,
          reason: 'no_active_skill',
          toolName,
          context: { message: 'Skill must be explicitly activated' },
        };
      }
      return {
        allowed: true,
        reason: 'no_active_skill',
        toolName,
      };
    }

    // No active skill - default allow
    if (session.activeSkills.size === 0) {
      return {
        allowed: true,
        reason: 'no_active_skill',
        toolName,
      };
    }

    // Get all active skill info for inclusion in results
    const activeSkillIds = Array.from(session.activeSkills.keys());
    const activeSkillNames = Array.from(session.activeSkills.values()).map((s) => s.name);

    // Helper to build common result fields
    const baseResult = {
      skillId: session.activeSkillId ?? undefined,
      skillName: session.activeSkillName ?? undefined,
      activeSkillIds,
      activeSkillNames,
      toolName,
    };

    // Check rate limiting
    if (this.options.maxToolCallsPerSession > 0 && session.toolCallCount >= this.options.maxToolCallsPerSession) {
      return {
        allowed: false,
        reason: 'rate_limited',
        ...baseResult,
        context: {
          limit: this.options.maxToolCallsPerSession,
          count: session.toolCallCount,
        },
      };
    }

    // Check session duration
    if (this.options.maxSessionDuration > 0) {
      const elapsed = Date.now() - session.startedAt;
      if (elapsed > this.options.maxSessionDuration) {
        this.deactivateSkill();
        return {
          allowed: true,
          reason: 'no_active_skill',
          toolName,
          context: { message: 'Session expired' },
        };
      }
    }

    // Check if tool was explicitly denied
    if (session.deniedTools.has(toolName)) {
      return {
        allowed: false,
        reason: 'denied',
        ...baseResult,
      };
    }

    // Check if tool is in the allowlist (combined from all active skills)
    if (session.allowedTools.has(toolName)) {
      return {
        allowed: true,
        reason: 'skill_allowlist',
        ...baseResult,
      };
    }

    // Check if tool was dynamically approved
    if (session.approvedTools.has(toolName)) {
      return {
        allowed: true,
        reason: 'dynamically_approved',
        ...baseResult,
      };
    }

    // Tool not in allowlist - behavior depends on policy mode
    switch (session.policyMode) {
      case 'strict':
        return {
          allowed: false,
          reason: 'not_in_allowlist',
          ...baseResult,
        };

      case 'approval':
        return {
          allowed: false,
          reason: 'not_in_allowlist',
          requiresApproval: true,
          ...baseResult,
        };

      case 'permissive':
      default:
        // Log warning but allow
        this.logger?.warn(`Tool '${toolName}' not in skill allowlist but allowed (permissive mode)`, {
          sessionId: session.sessionId,
          activeSkillIds,
        });
        return {
          allowed: true,
          reason: 'not_in_allowlist',
          ...baseResult,
          context: { warning: 'Tool not in allowlist but allowed in permissive mode' },
        };
    }
  }

  /**
   * Check if a tool is allowed without checking policy mode.
   * Simpler check for quick validation.
   */
  isToolAllowed(toolName: string): boolean {
    return this.checkToolAuthorization(toolName).allowed;
  }

  /**
   * Get the list of tools allowed by the current skill.
   */
  getToolAllowlist(): string[] {
    const session = this.getActiveSession();
    if (!session) return [];
    return Array.from(session.allowedTools);
  }

  /**
   * Dynamically approve a tool for the current session.
   * Used when policyMode is 'approval' and user approves a tool.
   */
  approveToolForSession(toolName: string): void {
    const session = this.getActiveSession();
    if (!session || !session.activeSkillId) {
      throw new Error('Cannot approve tool: no active skill session');
    }

    session.approvedTools.add(toolName);
    session.deniedTools.delete(toolName);

    this.emitSessionEvent({
      type: 'tool_approved',
      sessionId: session.sessionId,
      skillId: session.activeSkillId,
      toolName,
      timestamp: Date.now(),
    });

    this.logger?.info(`Tool dynamically approved: ${toolName}`, {
      sessionId: session.sessionId,
      skillId: session.activeSkillId,
    });

    this.persistSession(session);
  }

  /**
   * Deny a tool for the current session.
   */
  denyToolForSession(toolName: string): void {
    const session = this.getActiveSession();
    if (!session || !session.activeSkillId) {
      throw new Error('Cannot deny tool: no active skill session');
    }

    session.deniedTools.add(toolName);
    session.approvedTools.delete(toolName);

    this.emitSessionEvent({
      type: 'tool_denied',
      sessionId: session.sessionId,
      skillId: session.activeSkillId,
      toolName,
      timestamp: Date.now(),
    });

    this.logger?.info(`Tool denied: ${toolName}`, {
      sessionId: session.sessionId,
      skillId: session.activeSkillId,
    });

    this.persistSession(session);
  }

  /**
   * Record a tool call in the session.
   * Updates the tool call count for rate limiting.
   */
  recordToolCall(toolName: string): void {
    const session = this.getActiveSession();
    if (!session || !session.activeSkillId) return;

    session.toolCallCount++;

    if (this.options.trackToolUsage) {
      this.emitSessionEvent({
        type: 'tool_called',
        sessionId: session.sessionId,
        skillId: session.activeSkillId,
        toolName,
        timestamp: Date.now(),
        data: { callNumber: session.toolCallCount },
      });
    }

    this.persistSession(session);
  }

  /**
   * Get the current policy mode.
   */
  getPolicyMode(): string {
    const session = this.getActiveSession();
    return session?.policyMode ?? this.options.defaultPolicyMode;
  }

  /**
   * Set the policy mode for the current session.
   * Only applies if there's an active skill.
   */
  setPolicyMode(mode: SkillPolicyMode): void {
    const session = this.getActiveSession();
    if (!session || !session.activeSkillId) {
      throw new Error('Cannot set policy mode: no active skill session');
    }

    session.policyMode = mode;
    this.persistSession(session);

    this.logger?.debug(`Skill session policy mode changed to: ${mode}`, {
      sessionId: session.sessionId,
      skillId: session.activeSkillId,
    });
  }

  /**
   * Emit a session event.
   */
  private emitSessionEvent(event: SkillSessionEvent): void {
    this.emit('sessionEvent', event);
    this.emit(event.type, event);
  }

  /**
   * Persist session state to store if available.
   */
  private async persistSession(session: SkillSessionState): Promise<void> {
    if (this.store) {
      try {
        await this.store.save(session);
      } catch (error) {
        this.logger?.error('Failed to persist skill session', { error, sessionId: session.sessionId });
      }
    }
  }
}
