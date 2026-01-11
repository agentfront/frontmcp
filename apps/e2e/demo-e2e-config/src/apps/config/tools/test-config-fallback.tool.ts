import { z } from 'zod';
import { Tool, ToolContext } from '@frontmcp/sdk';
import {
  generateFallbacks,
  generateEnvFallbacks,
  normalizeNameForEnv,
  normalizePathSegment,
  ConfigEntityType,
} from '@frontmcp/sdk';

const inputSchema = z.object({
  key: z.string().describe('Config key to look up'),
  entityType: z.enum(['agents', 'plugins', 'adapters']).describe('Entity type'),
  entityName: z.string().describe('Entity name (can include dashes, spaces)'),
  customFallbacks: z.array(z.string()).optional().describe('Custom fallback paths (overrides auto)'),
  disableFallbacks: z.boolean().optional().describe('If true, disable fallbacks (direct lookup only)'),
});

type Input = z.infer<typeof inputSchema>;

interface FallbackResult {
  key: string;
  entityType: ConfigEntityType;
  entityName: string;
  normalizedName: string;
  generatedPaths: string[];
  generatedEnvKeys: string[];
  resolvedValue: string | null;
  resolvedFromPath: string | null;
  resolvedFromEnvKey: string | null;
  triedPaths: Array<{ path: string; envKey: string; value: string | null }>;
}

/**
 * Tool to test config fallback resolution.
 * Demonstrates the 3-level fallback chain:
 * 1. Entity-specific: {entityType}.{entityName}.{key}
 * 2. Entity-type default: {entityType}.{key}
 * 3. Global: {key}
 */
@Tool({
  name: 'test-config-fallback',
  description: 'Test config fallback resolution with entity context',
  inputSchema,
})
export default class TestConfigFallbackTool extends ToolContext<typeof inputSchema> {
  async execute(input: Input): Promise<FallbackResult> {
    const { key, entityType, entityName, customFallbacks, disableFallbacks } = input;

    // Normalize the entity name
    const normalizedName = normalizePathSegment(entityName);

    // Generate fallback paths
    let paths: string[];
    let envKeys: string[];

    if (disableFallbacks) {
      // Direct lookup only
      paths = [key];
      envKeys = [normalizeNameForEnv(key)];
    } else if (customFallbacks && customFallbacks.length > 0) {
      // Custom fallbacks
      paths = customFallbacks;
      envKeys = customFallbacks.map((p) => normalizeNameForEnv(p.replace(/\./g, '_')));
    } else {
      // Auto-generate fallbacks
      const context = { entityType, entityName };
      paths = generateFallbacks(key, context);
      envKeys = generateEnvFallbacks(key, context);
    }

    // Try each path and record results
    const triedPaths: Array<{ path: string; envKey: string; value: string | null }> = [];
    let resolvedValue: string | null = null;
    let resolvedFromPath: string | null = null;
    let resolvedFromEnvKey: string | null = null;

    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      const envKey = envKeys[i] || normalizeNameForEnv(path.replace(/\./g, '_'));

      // Try to get from process.env using the env key format
      const value = process.env[envKey] ?? null;

      triedPaths.push({ path, envKey, value });

      // First match wins
      if (value !== null && resolvedValue === null) {
        resolvedValue = value;
        resolvedFromPath = path;
        resolvedFromEnvKey = envKey;
      }
    }

    return {
      key,
      entityType,
      entityName,
      normalizedName,
      generatedPaths: paths,
      generatedEnvKeys: envKeys,
      resolvedValue,
      resolvedFromPath,
      resolvedFromEnvKey,
      triedPaths,
    };
  }
}
