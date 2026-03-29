import { Command } from 'commander';
import { c } from './colors';

/**
 * Command groups in display order, mapped to the command names they contain.
 * The `skills` group is handled separately to show subcommands inline.
 */
const GROUPS: [label: string, commands: string[]][] = [
  ['Getting Started', ['create', 'init', 'doctor']],
  ['Development', ['dev', 'build', 'test', 'inspector']],
  ['Process Manager', ['start', 'stop', 'restart', 'status', 'list', 'logs', 'socket', 'service']],
  ['Package Manager', ['install', 'uninstall', 'configure']],
];

const EXAMPLES: string[] = [
  'npx frontmcp create my-mcp              # Scaffold a new project',
  'frontmcp dev                             # Start dev server with hot-reload',
  'frontmcp build --target node             # Build for Node.js deployment',
  'frontmcp start my-app --port 3005        # Start managed server',
  'frontmcp install @company/my-mcp         # Install from npm registry',
  'frontmcp skills search "openapi"         # Find skills in catalog',
];

/** Format a top-level command line with cyan name and dim arg placeholders. */
function formatCommandLine(sub: Command, padWidth: number): string {
  const rawName = sub.name();
  const rawArgs = sub.registeredArguments.map((a) => (a.required ? `<${a.name()}>` : `[${a.name()}]`)).join(' ');
  const rawTerm = rawArgs ? `${rawName} ${rawArgs}` : rawName;

  const name = c('cyan', rawName);
  const args = sub.registeredArguments.map((a) => c('dim', a.required ? `<${a.name()}>` : `[${a.name()}]`)).join(' ');
  const term = args ? `${name} ${args}` : name;

  const padding = ' '.repeat(Math.max(2, padWidth - rawTerm.length + 2));
  return `  ${term}${padding}${sub.description()}`;
}

/** Format a skills subcommand as "skills <subname> <args>". */
function formatSkillsLine(sub: Command, padWidth: number): string {
  const rawPrefix = `skills ${sub.name()}`;
  const rawArgs = sub.registeredArguments.map((a) => (a.required ? `<${a.name()}>` : `[${a.name()}]`)).join(' ');
  const rawTerm = rawArgs ? `${rawPrefix} ${rawArgs}` : rawPrefix;

  const prefix = c('cyan', rawPrefix);
  const args = sub.registeredArguments.map((a) => c('dim', a.required ? `<${a.name()}>` : `[${a.name()}]`)).join(' ');
  const term = args ? `${prefix} ${args}` : prefix;

  const padding = ' '.repeat(Math.max(2, padWidth - rawTerm.length + 2));
  return `  ${term}${padding}${sub.description()}`;
}

/**
 * Apply custom help formatting to the top-level program so that
 * `frontmcp --help` groups commands under section headers, shows skills
 * subcommands inline, and appends a concise Examples block.
 */
export function customizeHelp(program: Command): void {
  program.configureHelp({
    formatHelp(cmd, helper) {
      let termWidth = helper.padWidth(cmd, helper);
      const lines: string[] = [];

      // Adjust padWidth to account for skills subcommand terms (e.g. "skills search <query>")
      const allCommands = helper.visibleCommands(cmd);
      const skillsCmd = allCommands.find((c) => c.name() === 'skills');
      const skillsSubs = skillsCmd ? helper.visibleCommands(skillsCmd) : [];
      if (skillsCmd) {
        for (const sub of skillsSubs) {
          const rawArgs = sub.registeredArguments
            .map((a) => (a.required ? `<${a.name()}>` : `[${a.name()}]`))
            .join(' ');
          const rawTerm = rawArgs ? `skills ${sub.name()} ${rawArgs}` : `skills ${sub.name()}`;
          termWidth = Math.max(termWidth, rawTerm.length);
        }
      }

      // Description
      const desc = helper.commandDescription(cmd);
      if (desc) lines.push(desc, '');

      // Usage
      lines.push(c('bold', 'Usage'));
      lines.push(`  ${helper.commandUsage(cmd)}`, '');

      // Grouped commands
      for (const [label, names] of GROUPS) {
        const matching = names.map((n) => allCommands.find((c) => c.name() === n)).filter(Boolean) as Command[];
        if (matching.length === 0) continue;

        lines.push(c('bold', label));
        for (const sub of matching) {
          lines.push(formatCommandLine(sub, termWidth));
        }
        lines.push('');
      }

      // Skills — show subcommands inline
      if (skillsCmd && skillsSubs.length > 0) {
        lines.push(c('bold', 'Skills'));
        for (const sub of skillsSubs) {
          lines.push(formatSkillsLine(sub, termWidth));
        }
        lines.push('');
      }

      // Other commands not in any group
      const renderedNames = new Set([...GROUPS.flatMap(([, names]) => names), 'skills']);
      const other = allCommands.filter((sc) => !renderedNames.has(sc.name()));
      if (other.length > 0) {
        lines.push(c('bold', 'Other'));
        for (const sub of other) {
          lines.push(formatCommandLine(sub, termWidth));
        }
        lines.push('');
      }

      // Global options
      const opts = helper.visibleOptions(cmd);
      if (opts.length > 0) {
        lines.push(c('bold', 'Options'));
        for (const opt of opts) {
          const term = helper.optionTerm(opt);
          const padding = ' '.repeat(Math.max(2, termWidth - term.length + 2));
          lines.push(`  ${term}${padding}${helper.optionDescription(opt)}`);
        }
        lines.push('');
      }

      return lines.join('\n');
    },
  });

  program.addHelpText('after', () => {
    const lines = [
      c('bold', 'Examples'),
      ...EXAMPLES.map((ex) => `  ${ex}`),
      '',
      c('dim', `Use ${c('cyan', 'frontmcp <command> --help')} for detailed usage of any command.`),
      '',
    ];
    return '\n' + lines.join('\n');
  });
}
