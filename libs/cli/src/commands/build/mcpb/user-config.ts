/**
 * Translate FrontMCP `setup.steps` and the deployment's `userConfig` into MCPB
 * `user_config` + `mcp_config.env`. Every entry reaches the server as an env var:
 * a step's `env` (else its id in UPPER_SNAKE_CASE), a `userConfig` entry's `env`
 * (else its key in UPPER_SNAKE_CASE).
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
import { ENV_VAR_NAME_PATTERN } from '../../../config/frontmcp-config.schema';
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

/** Default env var for a `userConfig` key: `deskApiKey` → `DESK_API_KEY`, `export-folder` → `EXPORT_FOLDER`. */
export function userConfigKeyToEnvName(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
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
  const envNameByKey: Record<string, string> = {};
  const warnings: string[] = [];

  for (const step of steps ?? []) {
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
    envNameByKey[key] = override?.env ?? step.env ?? idToEnvName(step.id);
  }

  for (const [key, option] of Object.entries(deployment?.userConfig ?? {})) {
    if (userConfig[key]) continue;
    const { env: explicitEnvName, ...entry } = option;
    userConfig[key] = entry;
    envNameByKey[key] = explicitEnvName ?? userConfigKeyToEnvName(key);
  }

  return { userConfig, env: bindEnvToUserConfig(envNameByKey), warnings };
}

/** `ENV_NAME → ${user_config.key}` for each entry; two entries may not share an env var. */
function bindEnvToUserConfig(envNameByKey: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  const keyByEnvName: Record<string, string> = {};
  for (const [key, envName] of Object.entries(envNameByKey)) {
    if (!ENV_VAR_NAME_PATTERN.test(envName)) {
      throw new Error(
        `userConfig "${key}" maps to "${envName}", which is not an environment variable name. Set userConfig.${key}.env.`,
      );
    }
    const otherKey = keyByEnvName[envName];
    if (otherKey) {
      throw new Error(
        `userConfig "${otherKey}" and "${key}" both map to the env var ${envName}. Give one of them its own env name (userConfig.<key>.env).`,
      );
    }
    keyByEnvName[envName] = key;
    env[envName] = `\${${USER_CONFIG_PREFIX}${key}}`;
  }
  return env;
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
