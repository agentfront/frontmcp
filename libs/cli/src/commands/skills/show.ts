import * as path from 'path';
import { c } from '../../core/colors';
import { fileExists, readFile } from '@frontmcp/utils';
import { loadCatalog, getCatalogDir } from './catalog';

export async function showSkill(name: string): Promise<void> {
  const manifest = loadCatalog();
  const entry = manifest.skills.find((s) => s.name === name);

  if (!entry) {
    console.error(c('red', `Skill "${name}" not found in catalog.`));
    console.log(c('gray', "Use 'frontmcp skills list' to see available skills."));
    process.exit(1);
  }

  const catalogDir = getCatalogDir();
  const skillDir = path.join(catalogDir, entry.path);
  const skillMd = path.join(skillDir, 'SKILL.md');

  if (!(await fileExists(skillMd))) {
    console.error(c('red', `SKILL.md not found at ${skillMd}`));
    process.exit(1);
  }

  const content = await readFile(skillMd);

  console.log(c('bold', `\n  ${entry.name}`));
  console.log(c('gray', `  Category: ${entry.category}`));
  console.log(c('gray', `  Tags: ${entry.tags.join(', ')}`));
  console.log(c('gray', `  Targets: ${entry.targets.join(', ')}`));
  console.log(c('gray', `  Bundle: ${entry.bundle?.join(', ') ?? 'none'}`));
  console.log(c('gray', `  Has resources: ${entry.hasResources}`));
  console.log('');
  console.log(c('gray', '  ─────────────────────────────────────'));
  console.log('');

  // Print body (skip frontmatter)
  const bodyStart = content.indexOf('---', 3);
  if (bodyStart !== -1) {
    const body = content.substring(bodyStart + 3).trim();
    console.log(body);
  } else {
    console.log(content);
  }

  console.log('');
  console.log(c('gray', `  Install: frontmcp skills install ${name} --provider claude`));
}
