import { Command } from 'commander';

const runBuild = jest.fn().mockResolvedValue(undefined);
jest.mock('../index.js', () => ({ runBuild }), { virtual: true });
jest.mock('../index', () => ({ runBuild }));

import { registerBuildCommands } from '../register';

function makeProgram(): Command {
  const program = new Command();
  program.option('-c, --config <path>', 'config file');
  program.exitOverride();
  registerBuildCommands(program);
  return program;
}

describe('registerBuildCommands', () => {
  beforeEach(() => runBuild.mockClear());

  it('forwards the top-level --config to runBuild', async () => {
    await makeProgram().parseAsync(['node', 'frontmcp', '--config', 'cfg/app.config.json', 'build', '-t', 'node']);

    expect(runBuild).toHaveBeenCalledTimes(1);
    expect(runBuild.mock.calls[0][0]).toMatchObject({ config: 'cfg/app.config.json' });
  });

  it('leaves config unset when --config is not given', async () => {
    await makeProgram().parseAsync(['node', 'frontmcp', 'build']);

    expect(runBuild.mock.calls[0][0].config).toBeUndefined();
  });

  it('defaults outDir to dist and passes -e as entry', async () => {
    await makeProgram().parseAsync(['node', 'frontmcp', 'build', '-e', 'src/other.ts']);

    expect(runBuild.mock.calls[0][0]).toMatchObject({ outDir: 'dist', entry: 'src/other.ts' });
  });
});
