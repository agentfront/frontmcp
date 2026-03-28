import * as path from 'path';
import { c } from '../../core/colors';
import { ensureDir, fileExists, cp } from '@frontmcp/utils';
import { loadCatalog, getCatalogDir } from './catalog';

const PROVIDER_DIRS: Record<string, string> = {
  claude: '.claude/skills',
  codex: '.codex/skills',
};

export interface InstallOptions {
  provider?: 'claude' | 'codex';
  dir?: string;
  all?: boolean;
  tag?: string;
  category?: string;
}

export async function installSkill(name: string | undefined, options: InstallOptions): Promise<void> {
  const manifest = loadCatalog();
  const provider = options.provider ?? 'claude';
  const targetBase = options.dir ?? path.resolve(process.cwd(), PROVIDER_DIRS[provider] ?? PROVIDER_DIRS['claude']);
  const catalogDir = getCatalogDir();

  // Validate that exactly one selector is supplied
  const selectorCount = [options.all, options.tag, options.category, name].filter(Boolean).length;
  if (selectorCount > 1) {
    console.error(c('red', 'Options --all, --tag, --category, and <name> are mutually exclusive.'));
    console.log(c('gray', 'Provide exactly one selector to choose which skills to install.'));
    process.exit(1);
  }

  // Determine which skills to install
  let skills = manifest.skills;

  if (options.all) {
    // Install all skills
  } else if (options.tag) {
    const tag = options.tag;
    skills = skills.filter((s) => s.tags.includes(tag));
    if (skills.length === 0) {
      console.error(c('red', `No skills found with tag "${tag}".`));
      console.log(c('gray', "Use 'frontmcp skills list --tag <tag>' to see available tags."));
      process.exit(1);
    }
  } else if (options.category) {
    skills = skills.filter((s) => s.category === options.category);
    if (skills.length === 0) {
      console.error(c('red', `No skills found in category "${options.category}".`));
      console.log(c('gray', "Use 'frontmcp skills list' to see available categories."));
      process.exit(1);
    }
  } else if (name) {
    // Single skill install
    const entry = skills.find((s) => s.name === name);
    if (!entry) {
      console.error(c('red', `Skill "${name}" not found in catalog.`));
      console.log(c('gray', "Use 'frontmcp skills list' to see available skills."));
      process.exit(1);
    }
    skills = [entry];
  } else {
    console.error(c('red', 'Please specify a skill name, or use --all, --tag, or --category.'));
    process.exit(1);
  }

  // Install each skill
  let installed = 0;
  for (const entry of skills) {
    const targetDir = path.join(targetBase, entry.name);
    const sourceDir = path.join(catalogDir, entry.path);

    if (!(await fileExists(path.join(sourceDir, 'SKILL.md')))) {
      console.error(c('yellow', `  Skipped ${entry.name}: source SKILL.md not found`));
      continue;
    }

    await ensureDir(targetDir);
    await cp(sourceDir, targetDir, { recursive: true });
    installed++;

    console.log(
      `${c('green', '✓')} Installed ${c('bold', entry.name)} to ${c('cyan', path.relative(process.cwd(), targetDir))}`,
    );
  }

  if (installed === 0) {
    console.error(c('red', `No skills were installed (0/${skills.length} had valid SKILL.md files).`));
    process.exit(1);
  }

  if (skills.length > 1) {
    console.log(`\n${c('green', '✓')} Installed ${installed}/${skills.length} skills (provider: ${provider})`);
  }
}
