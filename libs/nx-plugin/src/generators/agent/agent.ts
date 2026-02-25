import { type Tree, formatFiles, generateFiles, type GeneratorCallback } from '@nx/devkit';
import { join } from 'path';
import type { AgentGeneratorSchema } from './schema.js';
import { normalizePrimitiveOptions } from '../../utils/normalize-options.js';

export async function agentGenerator(tree: Tree, schema: AgentGeneratorSchema): Promise<GeneratorCallback | void> {
  const options = normalizePrimitiveOptions(tree, schema, 'agents');
  const model = schema.model ?? 'gpt-4';
  const toolRefs = schema.tools
    ? schema.tools
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  generateFiles(tree, join(__dirname, 'files'), options.directory, {
    ...options,
    model,
    toolRefs,
    tmpl: '',
  });

  if (!schema.skipFormat) {
    await formatFiles(tree);
  }
}

export default agentGenerator;
