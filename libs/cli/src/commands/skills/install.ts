import * as path from 'path';
import { c } from '../../core/colors';
import { ensureDir, fileExists, cp } from '@frontmcp/utils';
import { loadCatalog, getCatalogDir } from './catalog';

const PROVIDER_DIRS: Record<string, string> = {
  claude: '.claude/skills',
  codex: '.codex/skills',
};

export async function installSkill(
  name: string,
  options: { provider?: 'claude' | 'codex'; dir?: string },
): Promise<void> {
  const manifest = loadCatalog();
  const entry = manifest.skills.find((s) => s.name === name);

  if (!entry) {
    console.error(c('red', `Skill "${name}" not found in catalog.`));
    console.log(c('gray', "Use 'frontmcp skills list' to see available skills."));
    process.exit(1);
  }

  const provider = options.provider ?? 'claude';
  const targetBase = options.dir ?? path.resolve(process.cwd(), PROVIDER_DIRS[provider] ?? PROVIDER_DIRS['claude']);
  const targetDir = path.join(targetBase, name);

  const catalogDir = getCatalogDir();
  const sourceDir = path.join(catalogDir, entry.path);

  if (!(await fileExists(path.join(sourceDir, 'SKILL.md')))) {
    console.error(c('red', `Source SKILL.md not found at ${sourceDir}`));
    process.exit(1);
  }

  // Copy skill directory (binary-safe recursive copy)
  await ensureDir(targetDir);
  await cp(sourceDir, targetDir, { recursive: true });

  console.log(
    `${c('green', '✓')} Installed skill ${c('bold', name)} to ${c('cyan', path.relative(process.cwd(), targetDir))}`,
  );

  if (entry.hasResources) {
    console.log(c('gray', '  Includes: references/ directory'));
  }

  console.log(c('gray', `  Provider: ${provider}`));
  console.log(c('gray', `  Path: ${targetDir}`));
}
