import { Command } from 'commander';

import { registerSkillsCommands } from '../register';

/**
 * Surface-lock test for issue #414. Pins the exact set of `frontmcp skills`
 * subcommands so any addition (or removal) forces a contributor to update
 * the catalog reference at
 * `libs/skills/catalog/frontmcp-setup/references/frontmcp-skills-usage.md`.
 *
 * If you intentionally add a new subcommand, update BOTH the array below AND
 * the doc reference. The drift between the two is exactly what this test
 * exists to catch.
 */
function getSubcommand(name: string): Command {
  const program = new Command();
  registerSkillsCommands(program);
  const skills = program.commands.find((c) => c.name() === 'skills');
  expect(skills).toBeDefined();
  const sub = skills?.commands.find((c) => c.name() === name);
  expect(sub).toBeDefined();
  return sub as Command;
}

describe('registerSkillsCommands — CLI surface lock (issue #414)', () => {
  it('registers exactly these subcommands under `skills`', () => {
    const program = new Command();
    registerSkillsCommands(program);

    const skills = program.commands.find((c) => c.name() === 'skills');
    expect(skills).toBeDefined();

    const subcommandNames = (skills?.commands ?? []).map((c) => c.name()).sort();
    expect(subcommandNames).toEqual(['export', 'install', 'list', 'publish', 'read', 'search']);
  });

  it('install accepts the bulk-selector flags (--all/--tag/--category) documented in the reference', () => {
    const install = getSubcommand('install');
    const flagLongs = install.options.map((o) => o.long).filter(Boolean) as string[];
    expect(flagLongs).toEqual(expect.arrayContaining(['--provider', '--dir', '--all', '--tag', '--category']));
  });

  it('publish exposes the --token / --repository / --dry-run flags documented in the reference', () => {
    const publish = getSubcommand('publish');
    const flagLongs = publish.options.map((o) => o.long).filter(Boolean) as string[];
    expect(flagLongs).toEqual(expect.arrayContaining(['--target', '--token', '--repository', '--dry-run']));
  });

  it('export exposes the --target / --name / --all / --out flags documented in the reference', () => {
    const exp = getSubcommand('export');
    const flagLongs = exp.options.map((o) => o.long).filter(Boolean) as string[];
    expect(flagLongs).toEqual(expect.arrayContaining(['--target', '--name', '--all', '--out']));
  });

  it('list exposes --category / --tag / --bundle', () => {
    const list = getSubcommand('list');
    const flagLongs = list.options.map((o) => o.long).filter(Boolean) as string[];
    expect(flagLongs).toEqual(expect.arrayContaining(['--category', '--tag', '--bundle']));
  });

  it('read exposes --refs and --examples', () => {
    const read = getSubcommand('read');
    const flagLongs = read.options.map((o) => o.long).filter(Boolean) as string[];
    expect(flagLongs).toEqual(expect.arrayContaining(['--refs', '--examples']));
  });
});
