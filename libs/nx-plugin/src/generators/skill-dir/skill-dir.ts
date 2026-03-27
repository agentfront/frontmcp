import { type Tree, formatFiles, generateFiles, readProjectConfiguration, type GeneratorCallback } from '@nx/devkit';
import { join } from 'path';
import type { SkillDirGeneratorSchema } from './schema.js';

export async function skillDirGenerator(
  tree: Tree,
  schema: SkillDirGeneratorSchema,
): Promise<GeneratorCallback | void> {
  const projectConfig = readProjectConfiguration(tree, schema.project);
  const projectRoot = projectConfig.root;
  const baseDir = schema.directory ?? 'skills';
  const targetDir = join(projectRoot, baseDir);

  const tags = schema.tags
    ? schema.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
        .join(', ')
    : schema.name;

  const templateVars = {
    name: schema.name,
    description: schema.description ?? `Skill: ${schema.name}`,
    tags,
    tmpl: '',
  };

  generateFiles(tree, join(__dirname, 'files'), targetDir, templateVars);

  // Create references/ directory if requested
  if (schema.withReferences) {
    const refDir = join(targetDir, schema.name, 'references');
    tree.write(join(refDir, '.gitkeep'), '');
  }

  if (!schema.skipFormat) {
    await formatFiles(tree);
  }
}

export default skillDirGenerator;
