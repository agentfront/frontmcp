import { Command } from 'commander';
import { c } from './colors';

/** Group labels in display order, mapped to the command names they contain. */
const GROUPS: [label: string, commands: string[]][] = [
  ['Development', ['dev', 'build', 'test', 'init', 'doctor', 'inspector', 'create', 'socket']],
  ['Process Manager', ['start', 'stop', 'restart', 'status', 'list', 'logs', 'service']],
  ['Package Manager', ['install', 'uninstall', 'configure']],
];

/**
 * Apply custom help formatting to the top-level program so that
 * `frontmcp --help` groups commands under section headers and appends
 * an Examples block.
 */
export function customizeHelp(program: Command): void {
  program.configureHelp({
    formatHelp(cmd, helper) {
      const termWidth = helper.padWidth(cmd, helper);
      const lines: string[] = [];

      // Description
      const desc = helper.commandDescription(cmd);
      if (desc) lines.push(desc, '');

      // Usage
      lines.push(c('bold', 'Usage'));
      lines.push(`  ${helper.commandUsage(cmd)}`, '');

      // Grouped commands
      const allCommands = cmd.commands;
      for (const [label, names] of GROUPS) {
        const matching = names.map((n) => allCommands.find((c) => c.name() === n)).filter(Boolean) as Command[];
        if (matching.length === 0) continue;

        lines.push(c('bold', label));
        for (const sub of matching) {
          const name = sub.name();
          const args = sub.registeredArguments.map((a) => (a.required ? `<${a.name()}>` : `[${a.name()}]`)).join(' ');
          const term = args ? `${name} ${args}` : name;
          const padding = ' '.repeat(Math.max(2, termWidth - term.length + 2));
          lines.push(`  ${term}${padding}${sub.description()}`);
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

  program.addHelpText(
    'after',
    `
${c('bold', 'Examples')}
  frontmcp dev
  frontmcp build --out-dir build
  frontmcp build --exec
  frontmcp build --exec --cli
  frontmcp test --runInBand
  frontmcp init
  frontmcp doctor
  frontmcp inspector
  npx frontmcp create                          # Interactive mode
  npx frontmcp create my-mcp --yes             # Use defaults
  npx frontmcp create my-mcp --target vercel   # Vercel deployment
  frontmcp socket ./src/main.ts --socket /tmp/my-app.sock
  frontmcp start my-app --entry ./src/main.ts --port 3005
  frontmcp stop my-app
  frontmcp logs my-app --follow
  frontmcp service install my-app
  frontmcp install @company/my-mcp --registry https://npm.company.com
  frontmcp install ./my-local-app
  frontmcp install github:user/repo
  frontmcp configure my-app
  frontmcp uninstall my-app
`,
  );
}
