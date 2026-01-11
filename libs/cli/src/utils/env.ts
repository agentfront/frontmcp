// file: libs/cli/src/utils/env.ts
// CLI-specific environment loading utilities

import * as fs from 'fs';
import * as path from 'path';
import { c } from '../colors';

/**
 * Parse a .env file content into key-value pairs.
 * Follows dotenv parsing rules:
 * - Supports KEY=value format
 * - Supports quoted values (single and double quotes)
 * - Supports # comments
 * - Trims whitespace
 * - Expands escape sequences in double-quoted values (\n, \r, \t)
 *
 * @param content - Raw content of a .env file
 * @returns Record of key-value pairs
 */
export function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Match KEY=value pattern (KEY can contain letters, numbers, underscores)
    const match = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=(.*)$/);
    if (match) {
      const key = match[1];
      let value = match[2].trim();
      const originalValue = value;

      // Handle quoted values
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      // Expand escape sequences in double-quoted values
      // Order matters: handle double-backslash first (as a placeholder),
      // then other escapes, then convert placeholder back
      if (originalValue.startsWith('"')) {
        const PLACEHOLDER = '\x00BACKSLASH\x00';
        value = value
          .replace(/\\\\/g, PLACEHOLDER)
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(new RegExp(PLACEHOLDER, 'g'), '\\');
      }

      result[key] = value;
    }
  }

  return result;
}

/**
 * Load environment variables from .env files (synchronous).
 * Follows NestJS-style priority: .env.local overrides .env
 *
 * @param basePath - Base directory to resolve files from
 * @param envPath - Path to base .env file (relative to basePath)
 * @param localEnvPath - Path to local override file (relative to basePath)
 * @returns Record of merged environment variables
 */
export function loadEnvFilesSync(
  basePath = process.cwd(),
  envPath = '.env',
  localEnvPath = '.env.local',
): Record<string, string> {
  const result: Record<string, string> = {};

  // Load base .env file
  const envFile = path.resolve(basePath, envPath);
  if (fs.existsSync(envFile)) {
    const content = fs.readFileSync(envFile, 'utf8');
    Object.assign(result, parseEnvContent(content));
  }

  // Load .env.local (overrides base)
  const localFile = path.resolve(basePath, localEnvPath);
  if (fs.existsSync(localFile)) {
    const content = fs.readFileSync(localFile, 'utf8');
    Object.assign(result, parseEnvContent(content));
  }

  return result;
}

/**
 * Populate process.env with loaded values.
 * By default, does not override existing values.
 *
 * @param env - Environment variables to populate
 * @param override - Whether to override existing values (default: false)
 */
export function populateProcessEnv(env: Record<string, string>, override = false): void {
  for (const [key, value] of Object.entries(env)) {
    if (override || process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/**
 * Load environment variables for development.
 * Logs the number of loaded variables.
 *
 * @param cwd - Current working directory
 */
export function loadDevEnv(cwd: string): void {
  try {
    const env = loadEnvFilesSync(cwd, '.env', '.env.local');
    const count = Object.keys(env).length;

    if (count > 0) {
      populateProcessEnv(env, false);
      console.log(
        `${c('cyan', '[dev]')} loaded ${count} environment variable${count === 1 ? '' : 's'} from .env files`,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${c('yellow', '[dev]')} warning: failed to load .env files: ${message}`);
  }
}
