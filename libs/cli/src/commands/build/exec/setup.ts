/**
 * Setup questionnaire types and defineSetup() helper.
 * Provides the serializable step graph for interactive setup during install.
 */

/**
 * A single step in the setup questionnaire.
 * Fully serializable — no functions, no callbacks.
 */
export interface SetupStep {
  /** Unique step identifier */
  id: string;
  /** Question text shown to user */
  prompt: string;
  /** Help text / explanation */
  description?: string;
  /** Zod schema (in config.js) — converted to JSON Schema in manifest */
  schema?: unknown;
  /** JSON Schema (in manifest — serialized form) */
  jsonSchema?: Record<string, unknown>;
  /** Env var name (default: SCREAMING_SNAKE of id) */
  env?: string;
  /** Mask input (passwords, secrets) */
  sensitive?: boolean;
  /** Visual grouping label (e.g., 'Auth', 'Storage') */
  group?: string;
  /**
   * Graph routing — controls which step comes next.
   * - omitted: proceed to next step in array order
   * - string: unconditional jump to that step id
   * - Record<string, string>: route based on answer value → step id
   */
  next?: string | Record<string, string>;
  /**
   * Conditional visibility — show this step only when previous answers match.
   * { stepId: value } → show when stepId answer === value
   * { stepId: [v1, v2] } → show when answer is one of values
   * Multiple keys → AND condition (all must match)
   */
  showWhen?: Record<string, string | string[]>;
}

export interface SetupDefinition {
  steps: SetupStep[];
}

/**
 * Helper to define a setup questionnaire with type safety.
 */
export function defineSetup(definition: SetupDefinition): SetupDefinition {
  return definition;
}

/**
 * Convert a SetupStep's Zod schema to JSON Schema for manifest serialization.
 * Uses the same toJSONSchema pattern as the SDK.
 */
export function zodSchemaToJsonSchema(schema: unknown): Record<string, unknown> {
  try {
     
    const { toJSONSchema } = require('zod/v4');
    return toJSONSchema(schema) as Record<string, unknown>;
  } catch {
    try {
      // Fallback: try zod/v4/core
       
      const zodV4 = require('zod/v4/core');
      return zodV4.toJSONSchema(schema) as Record<string, unknown>;
    } catch {
      return { type: 'string' };
    }
  }
}

/**
 * Convert step id to SCREAMING_SNAKE_CASE env var name.
 */
export function idToEnvName(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
}

/**
 * Validate the step graph at build time.
 * Returns an array of error messages (empty = valid).
 */
export function validateStepGraph(steps: SetupStep[]): string[] {
  const errors: string[] = [];
  const ids = new Set(steps.map((s) => s.id));

  for (const step of steps) {
    // Check next targets
    if (typeof step.next === 'string') {
      if (!ids.has(step.next)) {
        errors.push(`Step "${step.id}": next target "${step.next}" does not exist`);
      }
    } else if (step.next && typeof step.next === 'object') {
      for (const [value, target] of Object.entries(step.next)) {
        if (!ids.has(target)) {
          errors.push(
            `Step "${step.id}": next target "${target}" (for value "${value}") does not exist`,
          );
        }
      }
    }

    // Check showWhen references
    if (step.showWhen) {
      for (const ref of Object.keys(step.showWhen)) {
        if (!ids.has(ref)) {
          errors.push(
            `Step "${step.id}": showWhen references non-existent step "${ref}"`,
          );
        }
      }
    }
  }

  // Check for cycles via DFS
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(id: string): boolean {
    if (inStack.has(id)) return true; // cycle
    if (visited.has(id)) return false;

    visited.add(id);
    inStack.add(id);

    const step = steps.find((s) => s.id === id);
    if (step) {
      const targets: string[] = [];
      if (typeof step.next === 'string') {
        targets.push(step.next);
      } else if (step.next && typeof step.next === 'object') {
        targets.push(...Object.values(step.next));
      }

      for (const target of targets) {
        if (ids.has(target) && dfs(target)) {
          errors.push(`Cycle detected involving step "${id}" → "${target}"`);
          inStack.delete(id);
          return true;
        }
      }
    }

    inStack.delete(id);
    return false;
  }

  for (const step of steps) {
    dfs(step.id);
  }

  // Warn about unreachable steps
  const reachable = new Set<string>();
  if (steps.length > 0) {
    const queue = [steps[0].id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (reachable.has(current)) continue;
      reachable.add(current);

      const step = steps.find((s) => s.id === current);
      if (!step) continue;

      if (typeof step.next === 'string') {
        queue.push(step.next);
      } else if (step.next && typeof step.next === 'object') {
        queue.push(...Object.values(step.next));
      } else {
        // Next in array order
        const idx = steps.indexOf(step);
        if (idx < steps.length - 1) {
          queue.push(steps[idx + 1].id);
        }
      }
    }

    for (const step of steps) {
      if (!reachable.has(step.id)) {
        // Unreachable steps that are only shown via showWhen may still be reachable via routing.
        // Only warn (don't error) since showWhen can make them visible.
        errors.push(`Warning: step "${step.id}" may be unreachable from the first step`);
      }
    }
  }

  return errors;
}
