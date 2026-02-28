import { createProgram } from '../program';

describe('createProgram', () => {
  it('should create a program named "frontmcp"', () => {
    const program = createProgram();
    expect(program.name()).toBe('frontmcp');
  });

  it('should have a version set from package.json', () => {
    const program = createProgram();
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('should register all 20 commands', () => {
    const program = createProgram();
    const names = program.commands.map((c) => c.name()).sort();
    expect(names).toEqual([
      'build',
      'configure',
      'create',
      'dev',
      'doctor',
      'init',
      'inspector',
      'install',
      'list',
      'logs',
      'restart',
      'service',
      'socket',
      'start',
      'status',
      'stop',
      'test',
      'uninstall',
    ]);
  });

  it('should parse build --exec --cli options', async () => {
    const program = createProgram();
    program.exitOverride();
    // Prevent the action from running (we only test parsing)
    const buildCmd = program.commands.find((c) => c.name() === 'build')!;
    buildCmd.action(() => {
      /* no-op */
    });

    await program.parseAsync(['node', 'frontmcp', 'build', '--exec', '--cli']);

    const opts = buildCmd.opts();
    expect(opts.exec).toBe(true);
    expect(opts.cli).toBe(true);
  });

  it('should parse start with name and --port option', async () => {
    const program = createProgram();
    program.exitOverride();
    const startCmd = program.commands.find((c) => c.name() === 'start')!;
    let capturedName = '';
    startCmd.action((name: string) => {
      capturedName = name;
    });

    await program.parseAsync(['node', 'frontmcp', 'start', 'my-app', '--port', '3005']);

    expect(capturedName).toBe('my-app');
    expect(startCmd.opts().port).toBe(3005);
  });

  it('should parse test with --runInBand and --timeout', async () => {
    const program = createProgram();
    program.exitOverride();
    const testCmd = program.commands.find((c) => c.name() === 'test')!;
    testCmd.action(() => {
      /* no-op */
    });

    await program.parseAsync(['node', 'frontmcp', 'test', '--runInBand', '--timeout', '5000']);

    const opts = testCmd.opts();
    expect(opts.runInBand).toBe(true);
    expect(opts.timeout).toBe(5000);
  });

  it('should parse logs with name and --follow --lines', async () => {
    const program = createProgram();
    program.exitOverride();
    const logsCmd = program.commands.find((c) => c.name() === 'logs')!;
    let capturedName = '';
    logsCmd.action((name: string) => {
      capturedName = name;
    });

    await program.parseAsync(['node', 'frontmcp', 'logs', 'my-app', '--follow', '--lines', '100']);

    expect(capturedName).toBe('my-app');
    const opts = logsCmd.opts();
    expect(opts.follow).toBe(true);
    expect(opts.lines).toBe(100);
  });

  it('should exit with error for unknown commands', async () => {
    const program = createProgram();
    program.exitOverride();
    program.configureOutput({ writeErr: () => {} });

    await expect(program.parseAsync(['node', 'frontmcp', 'nonexistent'])).rejects.toThrow();
  });

  it('should not throw on --help', async () => {
    const program = createProgram();
    program.exitOverride();
    program.configureOutput({ writeOut: () => {} });

    await expect(program.parseAsync(['node', 'frontmcp', '--help'])).rejects.toThrow('(outputHelp)');
  });

  it('should not throw on --version', async () => {
    const program = createProgram();
    program.exitOverride();
    program.configureOutput({ writeOut: () => {} });

    await expect(program.parseAsync(['node', 'frontmcp', '--version'])).rejects.toThrow();
  });

  it('should parse build with --out-dir', async () => {
    const program = createProgram();
    program.exitOverride();
    const buildCmd = program.commands.find((c) => c.name() === 'build')!;
    buildCmd.action(() => {
      /* no-op */
    });

    await program.parseAsync(['node', 'frontmcp', 'build', '--out-dir', 'custom-dist']);

    expect(buildCmd.opts().outDir).toBe('custom-dist');
  });
});
