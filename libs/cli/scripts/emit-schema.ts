#!/usr/bin/env tsx
/**
 * Emit `libs/cli/frontmcp.schema.json` from the Zod `frontmcpConfigSchema`
 * (issue #400). Runs as a build-time step so the published JSON Schema is
 * always in lock-step with the runtime validation rules.
 *
 * Usage:
 *   npx tsx libs/cli/scripts/emit-schema.ts
 *
 * Output:
 *   libs/cli/frontmcp.schema.json — referenced via the `$schema` field at
 *   the top of every `frontmcp.config.{json,ts,...}` file so IDEs get
 *   autocomplete + inline validation.
 */
import * as path from 'path';

import { writeFile } from '@frontmcp/utils';

import { frontmcpConfigSchema } from '../src/config/frontmcp-config.schema';

interface ZodToJsonSchemaFn {
  (schema: unknown, options?: { name?: string; target?: 'jsonSchema7' | 'openApi3' }): Record<string, unknown>;
}

async function main(): Promise<void> {
  let zodToJsonSchema: ZodToJsonSchemaFn;
  try {
    // Optional devDependency — schema emit is a build-time concern only.

    const mod = require('zod-to-json-schema') as { zodToJsonSchema: ZodToJsonSchemaFn };
    zodToJsonSchema = mod.zodToJsonSchema;
  } catch {
    console.error(
      'zod-to-json-schema is not installed. Install it as a devDependency to regenerate frontmcp.schema.json.',
    );
    process.exitCode = 1;
    return;
  }

  const schema = zodToJsonSchema(frontmcpConfigSchema, {
    name: 'FrontMcpConfig',
    target: 'jsonSchema7',
  });

  // Stamp a top-level URL the docs page references.
  const stamped = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'https://docs.agentfront.dev/frontmcp/schema/project.json',
    title: 'FrontMCP Project Config',
    description:
      'Validation schema for `frontmcp.config.{ts,js,json,mjs,cjs}` files consumed by every `frontmcp` CLI command (issue #400).',
    ...schema,
  };

  const out = path.resolve(__dirname, '..', 'frontmcp.schema.json');
  await writeFile(out, JSON.stringify(stamped, null, 2) + '\n');
  console.log(`Wrote ${out}`);
}

void main();
