import * as fs from 'fs';
import * as path from 'path';

import { buildFrontmcpConfigJsonSchema, FRONTMCP_CONFIG_SCHEMA_ID } from '../frontmcp-config.json-schema';

interface JsonSchemaNode {
  [keyword: string]: unknown;
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode & { oneOf?: JsonSchemaNode[] };
  additionalProperties?: boolean | JsonSchemaNode;
}

const committedPath = path.resolve(__dirname, '..', '..', '..', 'frontmcp.schema.json');

function deploymentVariant(schema: JsonSchemaNode, target: string): JsonSchemaNode {
  const variants = schema.properties?.['deployments']?.items?.oneOf ?? [];
  const variant = variants.find((candidate) => candidate.properties?.['target']?.['const'] === target);
  if (!variant) throw new Error(`no deployment variant for target "${target}"`);
  return variant;
}

describe('libs/cli/frontmcp.schema.json', () => {
  const committed = JSON.parse(fs.readFileSync(committedPath, 'utf8')) as JsonSchemaNode;
  const generated = buildFrontmcpConfigJsonSchema() as JsonSchemaNode;

  it('matches what libs/cli/scripts/emit-schema.ts generates (run it after changing frontmcpConfigSchema)', () => {
    expect(committed).toEqual(generated);
  });

  it('is a draft-07 schema at its frontmcp.dev $id', () => {
    expect(committed['$schema']).toBe('http://json-schema.org/draft-07/schema#');
    expect(committed['$id']).toBe(FRONTMCP_CONFIG_SCHEMA_ID);
    expect(FRONTMCP_CONFIG_SCHEMA_ID).toBe('https://frontmcp.dev/schemas/frontmcp.config.json');
  });

  it('covers every top-level key, rejects unknown ones, and requires only name and deployments', () => {
    expect(Object.keys(committed.properties ?? {}).sort()).toEqual([
      '$schema',
      'build',
      'cli',
      'clients',
      'deployments',
      'entry',
      'env',
      'name',
      'nodeVersion',
      'setup',
      'skills',
      'test',
      'transport',
      'version',
    ]);
    expect(committed.additionalProperties).toBe(false);
    expect(committed['required']).toEqual(['name', 'deployments']);
  });

  it('describes every deployment target, including mcpb', () => {
    const targets = (committed.properties?.['deployments']?.items?.oneOf ?? []).map(
      (variant) => variant.properties?.['target']?.['const'],
    );
    expect(targets.sort()).toEqual([
      'browser',
      'cli',
      'cloudflare',
      'distributed',
      'lambda',
      'mcpb',
      'node',
      'sdk',
      'vercel',
    ]);
  });

  it('carries descriptions, the userConfig env name, and the includeNodeModules deprecation', () => {
    expect(committed.properties?.['name']?.['description']).toBe('Server name (alphanumeric with .-_ only).');
    const mcpb = deploymentVariant(committed, 'mcpb');
    const userConfigEntry = mcpb.properties?.['userConfig']?.additionalProperties as JsonSchemaNode;
    expect(userConfigEntry.properties?.['env']?.['description']).toMatch(/UPPER_SNAKE_CASE/);
    expect(mcpb.properties?.['includeNodeModules']?.['deprecated']).toBe(true);
    expect(committed.properties?.['setup']?.properties?.['steps']).toBeDefined();
  });
});
