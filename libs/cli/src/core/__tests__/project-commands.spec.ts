import * as os from 'os';
import * as path from 'path';

import { Command } from 'commander';

import { mkdtemp, rm, writeFile } from '@frontmcp/utils';

import {
  dispatchToEntry,
  isCommandHidden,
  isProjectCommand,
  ProjectCommandFailedError,
  registerProjectCommands,
} from '../project-commands';

describe('registerProjectCommands', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'fmcp-409-'));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('is a no-op when no frontmcp.config exists', async () => {
    const program = new Command();
    await registerProjectCommands(program, tmp);
    expect(program.commands).toHaveLength(0);
  });

  it('registers a project command from cli.commands', async () => {
    await writeFile(
      path.join(tmp, 'frontmcp.config.json'),
      JSON.stringify({
        name: 'demo',
        deployments: [{ target: 'node' }],
        cli: {
          commands: {
            deploy: {
              entry: './scripts/deploy.ts',
              description: 'Ship it',
              arguments: [{ name: 'env', required: true }],
              options: [
                { flags: '-n, --dry-run', description: 'Skip writes' },
                { flags: '-c, --concurrency <num>', default: 4 },
              ],
            },
          },
        },
      }),
    );

    const program = new Command();
    await registerProjectCommands(program, tmp);

    expect(program.commands).toHaveLength(1);
    const deploy = program.commands[0];
    expect(deploy.name()).toBe('deploy');
    expect(deploy.description()).toBe('Ship it');
    expect(isProjectCommand(deploy)).toBe(true);

    // commander v13 stores registered arguments on the private `_args` array;
    // verify shape via parse behavior instead of property introspection.
    const opts = deploy.options.map((o) => o.flags);
    expect(opts).toContain('-n, --dry-run');
    expect(opts).toContain('-c, --concurrency <num>');

    // Replace the spawn action with a capture-only handler before parsing.
    let captured: { args: unknown[]; opts: Record<string, unknown> } | null = null;
    deploy.action((...all: unknown[]) => {
      const opts = all[all.length - 2] as Record<string, unknown>;
      const args = all.slice(0, all.length - 2);
      captured = { args, opts };
    });
    await program.parseAsync(['node', 'frontmcp', 'deploy', 'prod', '--dry-run']);
    expect(captured).not.toBeNull();
    expect(captured!.args[0]).toBe('prod');
    expect(captured!.opts.dryRun).toBe(true);
    expect(captured!.opts.concurrency).toBe(4);
  });

  it('registers multiple commands with kebab/colon names', async () => {
    await writeFile(
      path.join(tmp, 'frontmcp.config.json'),
      JSON.stringify({
        name: 'demo',
        deployments: [{ target: 'node' }],
        cli: {
          commands: {
            'db-migrate': { entry: './scripts/migrate.ts' },
            'project:init': { entry: './scripts/init.ts' },
          },
        },
      }),
    );

    const program = new Command();
    await registerProjectCommands(program, tmp);

    const names = program.commands.map((c) => c.name()).sort();
    expect(names).toEqual(['db-migrate', 'project:init']);
  });

  it('rejects configs that try to override a built-in verb', async () => {
    await writeFile(
      path.join(tmp, 'frontmcp.config.json'),
      JSON.stringify({
        name: 'demo',
        deployments: [{ target: 'node' }],
        cli: { commands: { dev: { entry: './scripts/dev.ts' } } },
      }),
    );

    const program = new Command();
    // safeLoad swallows schema errors and warns; the command is NOT registered.
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await registerProjectCommands(program, tmp);
    stderrSpy.mockRestore();

    expect(program.commands).toHaveLength(0);
  });

  it('honors hidden:true by tagging the command and exposing it via isCommandHidden', async () => {
    await writeFile(
      path.join(tmp, 'frontmcp.config.json'),
      JSON.stringify({
        name: 'demo',
        deployments: [{ target: 'node' }],
        cli: {
          commands: {
            'internal:debug': { entry: './scripts/debug.ts', hidden: true },
            'public:run': { entry: './scripts/run.ts' },
          },
        },
      }),
    );

    const program = new Command();
    await registerProjectCommands(program, tmp);

    const hidden = program.commands.find((c) => c.name() === 'internal:debug')!;
    const visible = program.commands.find((c) => c.name() === 'public:run')!;
    expect(isCommandHidden(hidden)).toBe(true);
    expect(isCommandHidden(visible)).toBe(false);
  });

  it('skips entries whose entry path escapes the project directory', async () => {
    await writeFile(
      path.join(tmp, 'frontmcp.config.json'),
      JSON.stringify({
        name: 'demo',
        deployments: [{ target: 'node' }],
        cli: {
          commands: {
            evil: { entry: '../../etc/passwd' },
            ok: { entry: './scripts/ok.ts' },
          },
        },
      }),
    );

    const program = new Command();
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await registerProjectCommands(program, tmp);
    stderrSpy.mockRestore();

    const names = program.commands.map((c) => c.name());
    expect(names).toContain('ok');
    expect(names).not.toContain('evil');
  });

  it('skips entries with absolute entry paths', async () => {
    await writeFile(
      path.join(tmp, 'frontmcp.config.json'),
      JSON.stringify({
        name: 'demo',
        deployments: [{ target: 'node' }],
        cli: {
          commands: {
            abs: { entry: '/tmp/x.ts' },
          },
        },
      }),
    );

    const program = new Command();
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await registerProjectCommands(program, tmp);
    stderrSpy.mockRestore();

    expect(program.commands).toHaveLength(0);
  });

  it('dispatchToEntry throws ProjectCommandFailedError when the runner exits non-zero', async () => {
    // Use a one-liner runner that exits with code 7 — node -e is portable across CI envs.
    const record = {
      verb: 'fail',
      entry: { entry: '-' }, // unused: dispatchToEntry uses record.entry.entry directly
      cwd: tmp,
    };
    // Build a fake record where entry resolves to the node binary itself; we
    // bypass resolveAndCheckEntry by calling dispatchToEntry directly.
    const fakeEntry = path.join(tmp, 'exit7.js');
    await writeFile(fakeEntry, 'process.exit(7);\n');
    const realRecord = {
      verb: 'fail',
      entry: { entry: fakeEntry },
      cwd: tmp,
    };

    await expect(dispatchToEntry(realRecord, [{} as Record<string, unknown>, {} as unknown])).rejects.toBeInstanceOf(
      ProjectCommandFailedError,
    );

    void record;
  });

  it('dispatchToEntry resolves when the runner exits 0 and forwards positionals + options as flags', async () => {
    const runner = path.join(tmp, 'echo.js');
    await writeFile(
      runner,
      "const fs = require('fs');\n" +
        'fs.writeFileSync(process.env.OUT_FILE, JSON.stringify({argv: process.argv.slice(2), payload: JSON.parse(process.env.FRONTMCP_PROJECT_COMMAND)}));\n' +
        'process.exit(0);\n',
    );
    const outFile = path.join(tmp, 'out.json');
    const prevOutFile = process.env.OUT_FILE;
    process.env.OUT_FILE = outFile;
    try {
      await dispatchToEntry({ verb: 'echo', entry: { entry: runner }, cwd: tmp }, [
        'prod',
        { dryRun: true, concurrency: 4, tags: ['a', 'b'] } as Record<string, unknown>,
        {},
      ]);
    } finally {
      if (prevOutFile === undefined) delete process.env.OUT_FILE;
      else process.env.OUT_FILE = prevOutFile;
    }

    const { readFile } = await import('@frontmcp/utils');
    const raw = await readFile(outFile);
    const captured = JSON.parse(raw) as {
      argv: string[];
      payload: { verb: string; positionals: unknown[]; options: Record<string, unknown> };
    };
    expect(captured.argv).toEqual(['prod', '--dry-run', '--concurrency', '4', '--tags', 'a', '--tags', 'b']);
    expect(captured.payload.verb).toBe('echo');
    expect(captured.payload.positionals).toEqual(['prod']);
    expect(captured.payload.options).toEqual({ dryRun: true, concurrency: 4, tags: ['a', 'b'] });
  });

  it('marks variadic positionals correctly', async () => {
    await writeFile(
      path.join(tmp, 'frontmcp.config.json'),
      JSON.stringify({
        name: 'demo',
        deployments: [{ target: 'node' }],
        cli: {
          commands: {
            inspect: {
              entry: './scripts/inspect.ts',
              arguments: [{ name: 'paths', variadic: true }],
            },
          },
        },
      }),
    );

    const program = new Command();
    await registerProjectCommands(program, tmp);

    const inspect = program.commands[0];
    let captured: unknown[] | null = null;
    inspect.action((...all: unknown[]) => {
      captured = all.slice(0, all.length - 2);
    });
    await program.parseAsync(['node', 'frontmcp', 'inspect', 'a.txt', 'b.txt', 'c.txt']);
    expect(captured).not.toBeNull();
    expect(captured![0]).toEqual(['a.txt', 'b.txt', 'c.txt']);
  });
});
