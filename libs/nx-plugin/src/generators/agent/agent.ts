import { join, relative } from 'path';

import { formatFiles, generateFiles, names, type GeneratorCallback, type Tree } from '@nx/devkit';

import { toFileName } from '../../utils/names.js';
import { normalizePrimitiveOptions } from '../../utils/normalize-options.js';
import type { AgentGeneratorSchema } from './schema.js';

export async function agentGenerator(tree: Tree, schema: AgentGeneratorSchema): Promise<GeneratorCallback | void> {
  const options = normalizePrimitiveOptions(tree, schema, 'agents');
  const model = schema.model ?? 'gpt-4';
  const toolsDir = join(options.projectSourceRoot, 'tools');
  const toolRefs = (schema.tools ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const importPath = relative(options.directory, join(toolsDir, `${toFileName(t)}.tool`))
        .split('\\')
        .join('/');
      return {
        className: names(t).className,
        importPath: importPath.startsWith('.') ? importPath : `./${importPath}`,
      };
    });
  const isAnthropic = model.toLowerCase().startsWith('claude');

  generateFiles(tree, join(__dirname, 'files'), options.directory, {
    ...options,
    model,
    llmProvider: isAnthropic ? 'anthropic' : 'openai',
    apiKeyEnv: isAnthropic ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY',
    toolRefs,
    tmpl: '',
  });

  if (!schema.skipFormat) {
    await formatFiles(tree);
  }
}

export default agentGenerator;
