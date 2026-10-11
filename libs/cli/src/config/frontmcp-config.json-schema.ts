/**
 * JSON Schema for `frontmcp.config.*`, generated from `frontmcpConfigSchema`.
 * `libs/cli/scripts/emit-schema.ts` writes it to `libs/cli/frontmcp.schema.json`
 * (shipped in the package), and a spec fails when that file drifts from this output.
 */

import { toJSONSchema } from '@frontmcp/lazy-zod';

import { frontmcpConfigSchema } from './frontmcp-config.schema';

export const FRONTMCP_CONFIG_SCHEMA_ID = 'https://frontmcp.dev/schemas/frontmcp.config.json';

export function buildFrontmcpConfigJsonSchema(): Record<string, unknown> {
  const generated = toJSONSchema(frontmcpConfigSchema, {
    target: 'draft-7',
    io: 'input',
    unrepresentable: 'any',
  }) as Record<string, unknown>;
  const { $schema, ...definition } = generated;
  return {
    $schema,
    $id: FRONTMCP_CONFIG_SCHEMA_ID,
    title: 'FrontMCP Configuration',
    description:
      'frontmcp.config.{ts,js,json,mjs,cjs}: deployment targets, build options, and the defaults every frontmcp command reads.',
    ...definition,
  };
}
