#!/usr/bin/env tsx
/**
 * Write `libs/cli/frontmcp.schema.json` from `frontmcpConfigSchema`.
 *
 * Usage:
 *   npx tsx libs/cli/scripts/emit-schema.ts
 *
 * The file is what `frontmcp.config.*` files point their `$schema` at, and it
 * ships in the `frontmcp` package. `nx test cli` fails when the committed file
 * differs from what this script writes, so run it after changing the schema.
 */
import * as path from 'path';

import { writeFile } from '@frontmcp/utils';

import { buildFrontmcpConfigJsonSchema } from '../src/config/frontmcp-config.json-schema';

async function main(): Promise<void> {
  const out = path.resolve(__dirname, '..', 'frontmcp.schema.json');
  const prettier = require('prettier') as typeof import('prettier');
  const formatted = await prettier.format(JSON.stringify(buildFrontmcpConfigJsonSchema()), {
    ...(await prettier.resolveConfig(out)),
    parser: 'json',
  });
  await writeFile(out, formatted);
  console.log(`Wrote ${out}`);
}

void main();
