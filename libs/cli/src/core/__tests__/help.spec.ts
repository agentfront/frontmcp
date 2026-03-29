import { createProgram } from '../program';

describe('customizeHelp', () => {
  function getHelpOutput(): string {
    const program = createProgram();
    // Capture help text without exiting
    let output = '';
    program.configureOutput({ writeOut: (str) => (output += str) });
    program.outputHelp();
    return output;
  }

  it('should contain "Getting Started" section header', () => {
    const help = getHelpOutput();
    expect(help).toContain('Getting Started');
  });

  it('should contain "Development" section header', () => {
    const help = getHelpOutput();
    expect(help).toContain('Development');
  });

  it('should contain "Process Manager" section header', () => {
    const help = getHelpOutput();
    expect(help).toContain('Process Manager');
  });

  it('should contain "Package Manager" section header', () => {
    const help = getHelpOutput();
    expect(help).toContain('Package Manager');
  });

  it('should contain "Skills" section header', () => {
    const help = getHelpOutput();
    expect(help).toContain('Skills');
  });

  it('should place "socket" after Process Manager header', () => {
    const help = getHelpOutput();
    const pmIdx = help.indexOf('Process Manager');
    const socketIdx = help.indexOf('socket');
    expect(pmIdx).toBeGreaterThan(-1);
    expect(socketIdx).toBeGreaterThan(-1);
    expect(socketIdx).toBeGreaterThan(pmIdx);
  });

  it('should show skills subcommands inline', () => {
    const help = getHelpOutput();
    expect(help).toContain('skills search');
    expect(help).toContain('skills list');
    expect(help).toContain('skills install');
    expect(help).toContain('skills read');
  });

  it('should list all commands in help output', () => {
    const help = getHelpOutput();
    // Strip ANSI escape codes before line matching

    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
    const helpLines = help.split(/\r?\n/).map((l) => stripAnsi(l).trim());

    const hasCommandLine = (cmd: string) => helpLines.some((line) => line === cmd || line.startsWith(cmd + ' '));

    const expectedCommands = [
      'dev',
      'build',
      'test',
      'init',
      'doctor',
      'inspector',
      'create',
      'socket',
      'start',
      'stop',
      'restart',
      'status',
      'list',
      'logs',
      'service',
      'install',
      'uninstall',
      'configure',
      'skills search',
      'skills list',
      'skills install',
      'skills read',
    ];

    for (const cmd of expectedCommands) {
      if (!hasCommandLine(cmd)) {
        fail(`Help output missing command '${cmd}'`);
      }
    }
  });

  it('should contain Examples section', () => {
    const help = getHelpOutput();
    expect(help).toContain('Examples');
    expect(help).toContain('frontmcp dev');
    expect(help).toContain('frontmcp build --target node');
  });

  it('should contain discoverability footer', () => {
    const help = getHelpOutput();
    expect(help).toContain('frontmcp <command> --help');
  });

  it('should show the improved description', () => {
    const help = getHelpOutput();
    expect(help).toContain('Build, test, and deploy MCP servers with FrontMCP');
  });

  it('should show subcommand help for build', () => {
    const program = createProgram();
    const buildCmd = program.commands.find((c) => c.name() === 'build');
    if (!buildCmd) throw new Error('Expected build command to exist');
    let output = '';
    buildCmd.configureOutput({ writeOut: (str) => (output += str) });
    buildCmd.outputHelp();
    expect(output).toContain('--target');
    expect(output).toContain('--js');
    expect(output).toContain('--out-dir');
  });
});
