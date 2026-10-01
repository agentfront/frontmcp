import * as fs from 'fs';
import { join } from 'path';

import { formatFiles, generateFiles, names as nxNames, type GeneratorCallback, type Tree } from '@nx/devkit';

import { addFrontmcpDependencies } from '../../utils/add-dependencies.js';
import { getLambdaDependencies } from '../../utils/versions.js';
import { normalizeOptions } from './lib/index.js';
import type { ServerGeneratorSchema } from './schema.js';

export async function serverGenerator(tree: Tree, schema: ServerGeneratorSchema): Promise<GeneratorCallback | void> {
  return serverGeneratorInternal(tree, schema);
}

async function serverGeneratorInternal(tree: Tree, schema: ServerGeneratorSchema): Promise<GeneratorCallback | void> {
  const options = normalizeOptions(tree, schema);

  const templateVars = {
    ...options,
    names: nxNames,
    tmpl: '',
    dot: '.',
  };

  // Generate common files (main.ts, project.json, tsconfig)
  generateFiles(tree, join(__dirname, 'files', 'common'), options.projectRoot, templateVars);

  // Generate target-specific files
  const targetDir = join(__dirname, 'files', options.deploymentTarget);
  generateFiles(tree, targetDir, options.projectRoot, templateVars);

  // Copy skills from catalog
  const bundle = schema.skills ?? 'recommended';
  if (bundle !== 'none') {
    scaffoldCatalogSkills(tree, options.projectRoot, options.deploymentTarget, bundle);
  }

  // The lambda build wraps the server with @codegenie/serverless-express and fails without it.
  const installTask =
    options.deploymentTarget === 'lambda'
      ? addFrontmcpDependencies(tree, getLambdaDependencies(), {}, { keepExistingVersions: true })
      : undefined;

  if (!options.skipFormat) {
    await formatFiles(tree);
  }

  return installTask;
}

function scaffoldCatalogSkills(tree: Tree, projectRoot: string, target: string, bundle: string): void {
  // Load skills catalog via @frontmcp/skills package at runtime
  let skills: {
    loadManifest: () => {
      skills: Array<{ name: string; path: string; targets: string[]; hasResources: boolean; bundle?: string[] }>;
    };
    resolveSkillPath: (entry: { path: string }) => string;
    getSkillsByTarget: (
      s: Array<{ targets: string[] }>,
      t: string,
    ) => Array<{ name: string; path: string; targets: string[]; hasResources: boolean; bundle?: string[] }>;
    getSkillsByBundle: (
      s: Array<{ bundle?: string[] }>,
      b: string,
    ) => Array<{ name: string; path: string; targets: string[]; hasResources: boolean; bundle?: string[] }>;
  };
  try {
    skills = require('@frontmcp/skills');
  } catch {
    return;
  }

  let manifest;
  try {
    manifest = skills.loadManifest();
  } catch {
    return;
  }

  const targetFiltered = skills.getSkillsByTarget(manifest.skills, target);
  const matchingSkills = skills.getSkillsByBundle(targetFiltered, bundle);

  for (const skill of matchingSkills) {
    const sourceDir = skills.resolveSkillPath(skill);
    const destDir = join(projectRoot, 'skills', skill.name);
    copyDirToTree(tree, sourceDir, destDir);
  }
}

function copyDirToTree(tree: Tree, sourceDir: string, destDir: string): void {
  if (!fs.existsSync(sourceDir)) return;
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(sourceDir, entry.name);
    const destPath = join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirToTree(tree, srcPath, destPath);
    } else {
      const content = fs.readFileSync(srcPath);
      tree.write(destPath, content);
    }
  }
}

export default serverGenerator;
