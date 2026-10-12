import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { type Command } from 'commander';

import { createProgram } from '../../../core/program';

async function registrySubcommand(name: string): Promise<{ program: Command; command: Command }> {
  const program = await createProgram();
  program.exitOverride();
  const registry = program.commands.find((c) => c.name() === 'registry');
  const command = registry?.commands.find((c) => c.name() === name);
  if (!command) throw new Error(`Expected registry ${name} to exist`);
  command.exitOverride().configureOutput({ writeErr: () => undefined });
  return { program, command };
}

describe('registerRegistryCommands', () => {
  it('registers keygen, publish and status with the documented flags', async () => {
    const { program } = await registrySubcommand('publish');
    const registry = program.commands.find((c) => c.name() === 'registry');
    const flags = (name: string) =>
      registry?.commands.find((c) => c.name() === name)?.options.map((option) => option.long);

    expect(registry?.commands.map((c) => c.name()).sort()).toEqual(['keygen', 'publish', 'status']);
    expect(flags('keygen')).toEqual(['--out', '--force']);
    expect(flags('publish')).toEqual([
      '--auth',
      '--domain',
      '--key-file',
      '--registry',
      '--entry',
      '--file',
      '--url',
      '--dry-run',
    ]);
    expect(flags('status')).toEqual(expect.arrayContaining(['--auth', '--server-version', '--message', '--name']));
  });

  it('parses status options, keeping --server-version away from the root --version', async () => {
    const { program, command } = await registrySubcommand('status');
    let captured: unknown;
    command.action((status: string, options: Record<string, unknown>) => {
      captured = { status, options };
    });

    await program.parseAsync([
      'node',
      'frontmcp',
      'registry',
      'status',
      'deprecated',
      '--server-version',
      '1.2.0',
      '--message',
      'Use 2.x',
    ]);

    expect(captured).toEqual({
      status: 'deprecated',
      options: { auth: 'http', serverVersion: '1.2.0', message: 'Use 2.x' },
    });
  });

  it('rejects an unknown status or login method', async () => {
    const { program } = await registrySubcommand('status');
    await expect(program.parseAsync(['node', 'frontmcp', 'registry', 'status', 'retired'])).rejects.toThrow(
      /Allowed choices are active, deprecated, deleted/,
    );
    const publish = await registrySubcommand('publish');
    await expect(
      publish.program.parseAsync(['node', 'frontmcp', 'registry', 'publish', '--auth', 'password']),
    ).rejects.toThrow(/Allowed choices are http, dns, github-oidc/);
  });

  it('prints a RegistryError without a stack and sets exit code 1', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-register-'));
    const keyPath = path.join(tempDir, 'existing.key');
    fs.writeFileSync(keyPath, 'existing');
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const previousExitCode = process.exitCode;
    try {
      const { program } = await registrySubcommand('keygen');
      await program.parseAsync(['node', 'frontmcp', 'registry', 'keygen', '--out', keyPath]);
      expect(process.exitCode).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(`${keyPath} already exists`));
    } finally {
      process.exitCode = previousExitCode;
      errorSpy.mockRestore();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
