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

  // Uniform-flag contract (issue #411 / cli-reference.mdx): install, uninstall,
  // and status all accept the same shared plugin-flag surface so docs + scripts
  // can rely on a single invocation contract. `uninstall` and `status` ignore
  // the `--dry-run` / `--only-mcp` / `--command` / `--env` / `--no-*` flags,
  // but accepting them keeps `Unknown option` from being thrown when callers
  // script the three subcommands together.
  const SHARED_PLUGIN_FLAGS = [
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
  ];

  it.each(['install', 'uninstall', 'status'])('%s exposes the full shared-plugin flag set', (name) => {
    const sub = getSubcommand(name);
    const longs = sub.options.map((o) => o.long).filter(Boolean) as string[];
    expect(longs).toEqual(expect.arrayContaining(SHARED_PLUGIN_FLAGS));
  });
});
