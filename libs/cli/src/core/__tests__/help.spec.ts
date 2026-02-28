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

  it('should list all commands in help output', () => {
    const help = getHelpOutput();
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
    ];

    for (const cmd of expectedCommands) {
      expect(help).toContain(cmd);
    }
  });

  it('should contain Examples section', () => {
    const help = getHelpOutput();
    expect(help).toContain('Examples');
    expect(help).toContain('frontmcp dev');
    expect(help).toContain('frontmcp build --exec');
  });

  it('should show subcommand help for build', () => {
    const program = createProgram();
    const buildCmd = program.commands.find((c) => c.name() === 'build')!;
    let output = '';
    buildCmd.configureOutput({ writeOut: (str) => (output += str) });
    buildCmd.outputHelp();
    expect(output).toContain('--exec');
    expect(output).toContain('--cli');
    expect(output).toContain('--out-dir');
  });
});
