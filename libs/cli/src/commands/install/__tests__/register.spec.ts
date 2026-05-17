import { Command } from 'commander';

import { registerInstallCommands } from '../register';

/**
 * Surface-lock for issue #411 — pins the exact set of `frontmcp plugin`
 * subcommands and the documented flag set. Any addition or rename here
 * forces a doc + catalog update.
 */
function getSubcommand(name: string): Command {
  const program = new Command();
  registerInstallCommands(program);
  const plugin = program.commands.find((c) => c.name() === 'plugin');
  expect(plugin).toBeDefined();
  const sub = plugin?.commands.find((c) => c.name() === name);
  expect(sub).toBeDefined();
  return sub as Command;
}

describe('registerInstallCommands — `frontmcp plugin` surface lock (issue #411)', () => {
  it('registers exactly these subcommands under `plugin`', () => {
    const program = new Command();
    registerInstallCommands(program);
    const plugin = program.commands.find((c) => c.name() === 'plugin');
    expect(plugin).toBeDefined();
    const subs = (plugin?.commands ?? []).map((c) => c.name()).sort();
    expect(subs).toEqual(['install', 'status', 'uninstall']);
  });

  it('install exposes all documented flags', () => {
    const install = getSubcommand('install');
    const longs = install.options.map((o) => o.long).filter(Boolean) as string[];
    expect(longs).toEqual(
      expect.arrayContaining([
        '--claude',
        '--codex',
        '--scope',
        '--no-skills',
        '--no-commands',
        '--only-mcp',
        '--command',
        '--env',
        '--dir',
        '--dry-run',
      ]),
    );
  });

  it('uninstall exposes --claude / --codex / --scope / --dir', () => {
    const uninstall = getSubcommand('uninstall');
    const longs = uninstall.options.map((o) => o.long).filter(Boolean) as string[];
    expect(longs).toEqual(expect.arrayContaining(['--claude', '--codex', '--scope', '--dir']));
  });

  it('status exposes --claude / --codex / --scope / --dir', () => {
    const status = getSubcommand('status');
    const longs = status.options.map((o) => o.long).filter(Boolean) as string[];
    expect(longs).toEqual(expect.arrayContaining(['--claude', '--codex', '--scope', '--dir']));
  });
});
