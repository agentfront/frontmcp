import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Command } from 'commander';

import { registerSkillsCommands } from '../register';

const mockExportFromEntry = jest.fn(async (_options: unknown) => undefined);
const mockExportSkills = jest.fn(async (_options: unknown) => undefined);
jest.mock('../export-from-entry', () => ({
  exportSkillsFromEntry: (options: unknown) => mockExportFromEntry(options),
}));
jest.mock('../export', () => ({ exportSkills: (options: unknown) => mockExportSkills(options) }));

describe('frontmcp skills export --from-entry options', () => {
  let dir: string;
  const cwd = process.cwd();

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-export-register-'));
    process.chdir(dir);
    mockExportFromEntry.mockClear();
    mockExportSkills.mockClear();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
  });
  afterEach(() => {
    process.chdir(cwd);
    jest.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function run(...args: string[]): Promise<void> {
    const program = new Command();
    program.option('--config <path>');
    registerSkillsCommands(program);
    await program.parseAsync(['node', 'frontmcp', 'skills', 'export', ...args]);
  }

  it('exports to claude by default, and to each provider listed once', async () => {
    await run('--from-entry', 'src/main.ts', '--all');
    expect(mockExportFromEntry).toHaveBeenLastCalledWith(
      expect.objectContaining({ entry: 'src/main.ts', providers: ['claude'], all: true }),
    );

    await run('--from-entry', 'src/main.ts', '-n', 'greeting', '-p', 'claude, codex,claude', '--check', '-d', 'out');
    expect(mockExportFromEntry).toHaveBeenLastCalledWith({
      entry: 'src/main.ts',
      providers: ['claude', 'codex'],
      name: 'greeting',
      all: undefined,
      outDir: 'out',
      check: true,
    });
    expect(mockExportSkills).not.toHaveBeenCalled();
  });

  it('takes the provider from skills.provider in frontmcp.config', async () => {
    fs.writeFileSync(
      path.join(dir, 'frontmcp.config.json'),
      JSON.stringify({ name: 'demo', deployments: [{ target: 'node' }], skills: { provider: 'codex' } }),
    );

    await run('--from-entry', 'src/main.ts', '--all');

    expect(mockExportFromEntry).toHaveBeenLastCalledWith(expect.objectContaining({ providers: ['codex'] }));
  });

  it('refuses --target with --from-entry, an unknown provider, and --provider or --check without it', async () => {
    await expect(run('--from-entry', 'src/main.ts', '--target', 'cursor')).rejects.toThrow('process.exit(1)');
    await expect(run('--from-entry', 'src/main.ts', '--provider', 'vim')).rejects.toThrow('process.exit(1)');
    await expect(run('--all', '--check')).rejects.toThrow('process.exit(1)');
    await expect(run('--all', '--provider', 'codex')).rejects.toThrow('process.exit(1)');

    const errors = (console.error as jest.Mock).mock.calls.map((call) => String(call[0]));
    expect(errors).toEqual([
      '--target exports catalog skills; use --provider with --from-entry.',
      'Invalid provider "vim". Valid providers: claude, codex',
      '--provider and --check apply to --from-entry exports.',
      '--provider and --check apply to --from-entry exports.',
    ]);
    expect(mockExportFromEntry).not.toHaveBeenCalled();
    expect(mockExportSkills).not.toHaveBeenCalled();
  });
});
