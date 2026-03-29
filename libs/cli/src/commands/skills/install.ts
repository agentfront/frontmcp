import * as path from 'path';
import { c } from '../../core/colors';
import { ensureDir, fileExists, cp, readFile, writeFile } from '@frontmcp/utils';
import { loadCatalog, getCatalogDir } from './catalog';

const PROVIDER_DIRS: Record<string, string> = {
  claude: '.claude/skills',
  codex: '.codex/skills',
};

/** The marker we look for in CLAUDE.md to know skills instructions are present. */
const SKILLS_MARKER = '# Skills and Tools';

/** Minimal CLAUDE.md content that instructs Claude to use installed skills. */
const CLAUDE_MD_SKILLS_SECTION = `# Skills and Tools

This project uses **FrontMCP skills** installed in \`.claude/skills/\`.
Before writing code, search the installed skills for relevant guidance:

- **Building components** (tools, resources, prompts, plugins, adapters) — check \`frontmcp-development\`
- **Testing** — check \`frontmcp-testing\`
- **Configuration** (auth, CORS, transport, sessions) — check \`frontmcp-config\`
- **Deployment** (Docker, Vercel, Lambda, Cloudflare) — check \`frontmcp-deployment\`
- **Production readiness** (security, performance, reliability) — check \`frontmcp-production-readiness\`

When you need to implement something, **read the matching skill first** — it contains patterns, examples, verification checklists, and common mistakes to avoid.
`;

export interface InstallOptions {
  provider?: 'claude' | 'codex';
  dir?: string;
  all?: boolean;
  tag?: string;
  category?: string;
}

/**
 * Ensure CLAUDE.md exists and contains skills usage instructions.
 * If the file doesn't exist, creates it with the skills section.
 * If it exists but lacks the skills marker, prepends the section.
 */
async function ensureClaudeMdSkillsInstructions(cwd: string): Promise<void> {
  const claudeMdPath = path.join(cwd, 'CLAUDE.md');

  if (await fileExists(claudeMdPath)) {
    const content = await readFile(claudeMdPath);
    if (content.includes(SKILLS_MARKER)) {
      // Already has skills instructions — nothing to do
      return;
    }
    // Exists but missing skills section — prepend it
    const updated = CLAUDE_MD_SKILLS_SECTION + '\n' + content;
    await writeFile(claudeMdPath, updated);
    console.log(`${c('green', '✓')} Updated ${c('cyan', 'CLAUDE.md')} with skills usage instructions`);
  } else {
    // Create new CLAUDE.md with skills section
    await writeFile(claudeMdPath, CLAUDE_MD_SKILLS_SECTION);
    console.log(`${c('green', '✓')} Created ${c('cyan', 'CLAUDE.md')} with skills usage instructions`);
  }
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

  // For Claude provider: ensure CLAUDE.md has skills usage instructions
  if (provider === 'claude') {
    await ensureClaudeMdSkillsInstructions(process.cwd());
  }
}
