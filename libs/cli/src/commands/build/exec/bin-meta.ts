/**
 * Issue #411 — write `bin-meta.json` next to the CLI bundle. The per-bin
 * `<bin> install -p claude|codex` reads this sidecar at runtime to drive
 * the shared plugin-emitter without re-running schema extraction.
 *
 * Shape:
 * {
 *   "name": "<bin>",
 *   "version": "<bin-version>",
 *   "description": "<from cliConfig or package.json>",
 *   "mcpDefault": { "command": "<bin>", "args": ["serve", "--stdio"] },
 *   "prompts": [{ "name", "description", "arguments": [...] }],
 *   "skills": [{ "name", "description", "instructionFile" (path under _skills/), "resourceDirs": { references?, examples?, scripts?, assets? } }]
 * }
 */

import * as path from 'path';

import { writeJSON } from '@frontmcp/utils';

import type { FrontmcpExecConfig } from './config';
import type { ExtractedSchema } from './cli-runtime/schema-extractor';

export interface BinMeta {
  name: string;
  version: string;
  description: string;
  mcpDefault: { command: string; args: string[] };
  prompts: Array<{
    name: string;
    description?: string;
    arguments?: Array<{ name: string; description?: string; required?: boolean }>;
  }>;
  skills: Array<{
    name: string;
    description?: string;
    tags?: string[];
    license?: string;
    instructionFile?: string;
    resourceDirs?: { references?: string; examples?: string; scripts?: string; assets?: string };
  }>;
}

export async function writeBinMeta(
  outDir: string,
  config: FrontmcpExecConfig,
  schema: ExtractedSchema,
): Promise<void> {
  const meta: BinMeta = {
    name: config.name,
    version: config.version ?? '0.0.0',
    description: config.cli?.description ?? `${config.name} (FrontMCP server)`,
    mcpDefault: { command: config.name, args: ['serve', '--stdio'] },
    prompts: schema.prompts.map((p) => ({
      name: p.name,
      description: p.description,
      arguments: p.arguments,
    })),
    skills: schema.skillAssets.map((asset) => {
      // The bin runtime expects RELATIVE paths under `_skills/` so the bundle
      // is portable across install destinations.
      const instructionFile = asset.instructionFile
        ? path.join('_skills', `${asset.skillName}--${path.basename(asset.instructionFile)}`)
        : undefined;
      const resourceDirs: BinMeta['skills'][number]['resourceDirs'] = {};
      for (const kind of ['references', 'examples', 'scripts', 'assets'] as const) {
        if (asset.resourceDirs?.[kind]) {
          resourceDirs[kind] = path.join('_skills', `${asset.skillName}--${kind}`);
        }
      }
      return {
        name: asset.skillName,
        description: asset.description,
        tags: asset.tags && asset.tags.length > 0 ? asset.tags : undefined,
        license: asset.license,
        instructionFile,
        resourceDirs: Object.keys(resourceDirs).length > 0 ? resourceDirs : undefined,
      };
    }),
  };

  // Drop undefined fields so the JSON payload matches the TS interface (no
  // explicit "description": undefined keys land in stringified output).
  const cleanSkills = meta.skills.map((s) => omitUndefined(s));
  await writeJSON(path.join(outDir, 'bin-meta.json'), { ...meta, skills: cleanSkills });
}

function omitUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k as keyof T] = v as T[keyof T];
  }
  return out;
}
