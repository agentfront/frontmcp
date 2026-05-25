import { type Command } from 'commander';

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
    .description('Install skill(s) to a provider directory (.claude/skills or .codex/skills)')
    .argument('[name]', 'Skill name to install (optional with --all, --tag, or --category)')
    .option('-p, --provider <provider>', 'Target provider: claude, codex (default: claude)', 'claude')
    .option('-d, --dir <directory>', 'Custom install directory (overrides provider default)')
    .option(
      '-a, --all',
      'Install all skills from the catalog (or all @Skill entries when --from-entry/--from-package is set)',
    )
    .option('-t, --tag <tag>', 'Install all skills matching a tag (catalog only)')
    .option('-c, --category <category>', 'Install all skills in a category (catalog only)')
    .option(
      '--from-entry <path>',
      'Install @Skill entries from a local project entry file instead of the framework catalog',
    )
    .option(
      '--from-package <pkg>',
      "Install @Skill entries from a published package's main entry instead of the framework catalog",
    )
    .action(
      async (
        name: string | undefined,
        options: {
          provider?: string;
          dir?: string;
          all?: boolean;
          tag?: string;
          category?: string;
          fromEntry?: string;
          fromPackage?: string;
        },
      ) => {
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
          all: options.all,
          tag: options.tag,
          category: options.category,
          fromEntry: options.fromEntry,
          fromPackage: options.fromPackage,
        });
      },
    );

  skills
    .command('export')
    .description('Convert a catalog skill into a Cursor / Windsurf / Copilot rule file in the current directory')
    .option('-t, --target <target>', 'Target IDE: cursor | windsurf | copilot', 'cursor')
    .option('-n, --name <name>', 'Skill name to export (required unless --all is set)')
    .option('-a, --all', 'Export every skill in the catalog')
    .option('-d, --out <directory>', 'Output directory (default: cwd)')
    .action(async (options: { target?: string; name?: string; all?: boolean; out?: string }) => {
      const validTargets = ['cursor', 'windsurf', 'copilot'] as const;
      type Target = (typeof validTargets)[number];
      const t = (options.target ?? 'cursor') as Target;
      if (!validTargets.includes(t)) {
        console.error(`Invalid target "${options.target}". Valid targets: ${validTargets.join(', ')}`);
        process.exit(1);
      }
      const { exportSkills } = await import('./export.js');
      await exportSkills({
        target: t,
        name: options.name,
        all: options.all,
        outDir: options.out,
      });
    });

  skills
    .command('publish')
    .description('Publish a skill to a public marketplace (Smithery or Glama)')
    .argument('<name>', 'Skill name to publish')
    .option('-t, --target <target>', 'Marketplace target: smithery | glama', 'smithery')
    .option('--token <token>', 'API token (defaults to SMITHERY_TOKEN / GLAMA_TOKEN env)')
    .option('--repository <url>', 'Repository URL to advertise on the marketplace')
    .option('--dry-run', 'Print the payload + endpoint without submitting')
    .action(
      async (name: string, options: { target?: string; token?: string; repository?: string; dryRun?: boolean }) => {
        const validTargets = ['smithery', 'glama'] as const;
        type Target = (typeof validTargets)[number];
        const t = (options.target ?? 'smithery') as Target;
        if (!validTargets.includes(t)) {
          console.error(`Invalid target "${options.target}". Valid targets: ${validTargets.join(', ')}`);
          process.exit(1);
        }
        const { publishSkill } = await import('./publish.js');
        await publishSkill({
          target: t,
          name,
          token: options.token,
          repository: options.repository,
          dryRun: options.dryRun,
        });
      },
    );

  skills
    .command('read')
    .description('Read a skill, its references, or any file in the skill directory')
    .argument('<nameOrPath>', 'Skill name or skill:filepath (e.g., frontmcp-dev:references/create-tool.md)')
    .argument('[reference]', 'Reference name to read (e.g., create-tool)')
    .option('--refs', 'List all available references for the skill')
    .option('--examples [reference]', 'List examples for the skill, optionally filtered by reference name')
    .action(
      async (name: string, reference: string | undefined, options: { refs?: boolean; examples?: boolean | string }) => {
        const { readSkill } = await import('./read.js');
        await readSkill(name, {
          reference,
          listRefs: options.refs,
          listExamples: options.examples === true ? true : undefined,
          examplesForRef: typeof options.examples === 'string' ? options.examples : undefined,
        });
      },
    );
}
