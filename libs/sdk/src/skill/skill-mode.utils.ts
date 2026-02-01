// file: libs/sdk/src/skill/skill-mode.utils.ts

/**
 * Utilities for skills-only mode detection.
 *
 * Skills-only mode is a special operational mode where:
 * - The tools list returns empty (no tools exposed)
 * - Only skill discovery tools are available
 * - Used for planner agents that need skills but not execution tools
 *
 * @module skill/skill-mode.utils
 */

/**
 * Session payload interface for skills-only mode detection.
 */
export interface SkillsOnlySessionPayload {
  skillsOnlyMode?: boolean;
}

/**
 * Detect if skills-only mode is requested from query parameters.
 *
 * Skills-only mode returns empty tools list, exposing only skill discovery.
 * Clients can request this mode by adding `?mode=skills_only` to the connection URL.
 *
 * @param query - Query parameters from the request (may be undefined)
 * @returns true if skills_only mode is requested
 *
 * @example
 * ```typescript
 * // In transport flow
 * const query = request.query as Record<string, string | string[]> | undefined;
 * const skillsOnlyMode = detectSkillsOnlyMode(query);
 * ```
 */
export function detectSkillsOnlyMode(query: Record<string, string | string[] | undefined> | undefined): boolean {
  if (!query) return false;

  const mode = query['mode'];

  // Handle single value
  if (mode === 'skills_only') {
    return true;
  }

  // Handle array of values (e.g., ?mode=skills_only&mode=other)
  if (Array.isArray(mode) && mode.includes('skills_only')) {
    return true;
  }

  return false;
}

/**
 * Check if the current session is in skills-only mode.
 *
 * This checks the session payload for the skillsOnlyMode flag that was
 * set during session creation based on the initial query parameters.
 *
 * @param sessionPayload - Session payload from authorization (may be undefined)
 * @returns true if the session is in skills-only mode
 *
 * @example
 * ```typescript
 * // In tools/list flow
 * const isSkillsOnly = isSkillsOnlySession(authorization.session?.payload);
 * if (isSkillsOnly) {
 *   return { tools: [] }; // Return empty tools list
 * }
 * ```
 */
export function isSkillsOnlySession(sessionPayload: SkillsOnlySessionPayload | undefined): boolean {
  return sessionPayload?.skillsOnlyMode === true;
}
