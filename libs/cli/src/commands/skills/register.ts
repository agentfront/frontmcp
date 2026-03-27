import { Command } from 'commander';

export function registerSkillsCommands(program: Command): void {
  const skills = program.command('skills').description('Search, list, and install skills from the FrontMCP catalog');

  skills
    .command('search')
    .description('Search the skills catalog using semantic text matching')
    .argument('<query>', 'Search text (matches descriptions, tags, and names)')
    .option('-n, --limit <count>', 'Maximum results to return', '10')
    .option('-t, --tag <tag>', 'Filter by tag')
    .option('-c, --category <category>', 'Filter by category')
    .action(async (query: string, options: { limit?: string; tag?: string; category?: string }) => {
      const { searchSkills } = await import('./search.js');
      await searchSkills(query, {
        limit: Math.max(1, Number(options.limit) || 10),
        tag: options.tag,
        category: options.category,
      });
    });

  skills
    .command('list')
    .description('List all available skills in the catalog')
    .option('-c, --category <category>', 'Filter by category')
    .option('-t, --tag <tag>', 'Filter by tag')
    .option('-b, --bundle <bundle>', 'Filter by bundle (recommended, minimal, full)')
    .action(async (options: { category?: string; tag?: string; bundle?: string }) => {
      const { listSkills } = await import('./list.js');
      await listSkills(options);
    });

  skills
    .command('install')
    .description('Install a skill to a provider directory (.claude/skills or .codex/skills)')
    .argument('<name>', 'Skill name to install')
    .option('-p, --provider <provider>', 'Target provider: claude, codex (default: claude)', 'claude')
    .option('-d, --dir <directory>', 'Custom install directory (overrides provider default)')
    .action(async (name: string, options: { provider?: string; dir?: string }) => {
      const validProviders = ['claude', 'codex'] as const;
      type Provider = (typeof validProviders)[number];
      const raw = options.provider;
      if (raw && !validProviders.includes(raw as Provider)) {
        console.error(`Invalid provider "${raw}". Valid providers: ${validProviders.join(', ')}`);
        process.exit(1);
      }
      const { installSkill } = await import('./install.js');
      await installSkill(name, {
        provider: raw as Provider | undefined,
        dir: options.dir,
      });
    });

  skills
    .command('show')
    .description('Show full details of a skill including instructions')
    .argument('<name>', 'Skill name')
    .action(async (name: string) => {
      const { showSkill } = await import('./show.js');
      await showSkill(name);
    });
}
