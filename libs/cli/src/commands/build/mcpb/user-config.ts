/**
 * Translate FrontMCP `setup.steps` into MCPB `user_config` + `mcp_config.env`.
 *
 * MCPB's user_config is a flat key/value form. FrontMCP's setup graph supports
 * branching (`step.next`) and conditional visibility (`step.showWhen`). Those
 * features have no MCPB equivalent — we emit a warning and render every step
 * unconditionally.
 */

import { idToEnvName, type SetupStep, zodSchemaToJsonSchema } from '../exec/setup';
import type {
  McpbDeployment,
  McpbUserConfigEntry,
  McpbUserConfigType,
} from '../../../config/frontmcp-config.types';
import { USER_CONFIG_PREFIX } from './constants';

export interface UserConfigTranslationResult {
  /** MCPB user_config block. */
  userConfig: Record<string, McpbUserConfigEntry>;
  /** mcp_config.env map: ENV_NAME → ${user_config.key}. */
  env: Record<string, string>;
  /** Warnings to surface to the CLI log. */
  warnings: string[];
}

/** Convert kebab/snake/SCREAMING_SNAKE id to camelCase for the MCPB key. */
export function idToCamelKey(id: string): string {
  const normalized = id.replace(/[^a-zA-Z0-9]+/g, ' ').trim().toLowerCase();
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'value';
  return parts
    .map((part, idx) => (idx === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join('');
}

/** Resolve the user_config.type for a setup step. */
function resolveType(
  jsonSchema: Record<string, unknown>,
  override?: McpbUserConfigType,
): { type: McpbUserConfigType; multiple: boolean } {
  if (override) {
    return { type: override, multiple: false };
  }
  const schemaType = jsonSchema['type'];
  if (schemaType === 'boolean') return { type: 'boolean', multiple: false };
  if (schemaType === 'number' || schemaType === 'integer') {
    return { type: 'number', multiple: false };
  }
  if (schemaType === 'array') {
    const items = jsonSchema['items'];
    const itemType =
      items && typeof items === 'object' && 'type' in items
        ? (items as { type: unknown }).type
        : 'string';
    if (itemType === 'number' || itemType === 'integer') {
      return { type: 'number', multiple: true };
    }
    if (itemType === 'boolean') {
      return { type: 'boolean', multiple: true };
    }
    return { type: 'string', multiple: true };
  }
  return { type: 'string', multiple: false };
}

/**
 * Produce MCPB user_config + env mapping from FrontMCP setup steps.
 * Also applies any per-key `deployment.userConfig` overrides (e.g., to change
 * type to `file` or `directory`).
 */
export function setupStepsToUserConfig(
  steps: SetupStep[] | undefined,
  deployment?: McpbDeployment,
): UserConfigTranslationResult {
  const userConfig: Record<string, McpbUserConfigEntry> = {};
  const env: Record<string, string> = {};
  const warnings: string[] = [];

  if (!steps || steps.length === 0) {
    // Allow deployment.userConfig to stand alone (no setup graph).
    if (deployment?.userConfig) {
      for (const [key, entry] of Object.entries(deployment.userConfig)) {
        userConfig[key] = entry;
      }
    }
    return { userConfig, env, warnings };
  }

  for (const step of steps) {
    if (step.showWhen || step.next) {
      warnings.push(
        `Step "${step.id}" uses showWhen/next — MCPB has no equivalent; rendered unconditionally`,
      );
    }

    const jsonSchema =
      step.jsonSchema ?? (step.schema ? zodSchemaToJsonSchema(step.schema) : { type: 'string' });
    const key = idToCamelKey(step.id);
    const override = deployment?.userConfig?.[key];

    const { type, multiple } = resolveType(jsonSchema, override?.type);

    const entry: McpbUserConfigEntry = {
      type,
      title: override?.title ?? step.prompt,
      ...(step.description || override?.description
        ? { description: override?.description ?? step.description }
        : {}),
      ...(step.sensitive || override?.sensitive ? { sensitive: true } : {}),
      ...(multiple || override?.multiple ? { multiple: true } : {}),
    };

    const required = inferRequired(jsonSchema, override?.required);
    if (required) entry.required = true;

    const defaultVal = jsonSchema['default'] ?? override?.default;
    if (defaultVal !== undefined && !entry.sensitive) {
      if (
        (entry.type === 'string' || entry.type === 'directory' || entry.type === 'file') &&
        typeof defaultVal === 'string'
      ) {
        entry.default = defaultVal;
      } else if (entry.type === 'number' && typeof defaultVal === 'number') {
        entry.default = defaultVal;
      } else if (entry.type === 'boolean' && typeof defaultVal === 'boolean') {
        entry.default = defaultVal;
      }
    }

    const min = pickNumber(jsonSchema['minimum'] ?? jsonSchema['minLength']) ?? override?.min;
    const max = pickNumber(jsonSchema['maximum'] ?? jsonSchema['maxLength']) ?? override?.max;
    if (min !== undefined) entry.min = min;
    if (max !== undefined) entry.max = max;

    // Merge explicit deployment.userConfig fields that weren't captured above.
    if (override) {
      for (const prop of ['title', 'description', 'required', 'multiple', 'sensitive', 'min', 'max', 'default'] as const) {
        if (override[prop] !== undefined && entry[prop] === undefined) {
          (entry as unknown as Record<string, unknown>)[prop] = override[prop];
        }
      }
    }

    userConfig[key] = entry;

    const envName = step.env ?? idToEnvName(step.id);
    env[envName] = `\${${USER_CONFIG_PREFIX}${key}}`;
  }

  // Any deployment.userConfig entries not derived from a setup step are merged verbatim.
  if (deployment?.userConfig) {
    for (const [key, entry] of Object.entries(deployment.userConfig)) {
      if (!userConfig[key]) {
        userConfig[key] = entry;
      }
    }
  }

  return { userConfig, env, warnings };
}

function inferRequired(jsonSchema: Record<string, unknown>, override?: boolean): boolean {
  if (override !== undefined) return override;
  // JSON Schema 'required' arrays apply at the parent level; for a single-value
  // schema, treat missing default + no `.optional()` marker as required.
  if (jsonSchema['default'] !== undefined) return false;
  // Best-effort: Zod/v4 encodes optional as a union with undefined or nullable.
  const anyOf = jsonSchema['anyOf'];
  if (Array.isArray(anyOf) && anyOf.some((s) => s && typeof s === 'object' && (s as { type?: string }).type === 'null')) {
    return false;
  }
  return true;
}

function pickNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
