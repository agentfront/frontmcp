import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('../exec/index', () => ({ buildExec: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../../shared/clean-out-dir', () => ({ cleanOutDir: jest.fn().mockResolvedValue(undefined) }));

import { buildExec } from '../exec/index';
import { runBuild } from '../index';

const mockBuildExec = buildExec as jest.Mock;

describe('cli deployment options reach the exec build', () => {
  let tmp: string;
  const originalCwd = process.cwd();

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frontmcp-cli-overrides-'));
    process.chdir(tmp);
  });
  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  it('forwards cli.excludeTools and cli.oauth', async () => {
    const config = {
      name: 'demo',
      deployments: [
        {
          target: 'cli',
          cli: {
            authRequired: true,
            excludeTools: ['internal_tool'],
            oauth: { serverUrl: 'https://auth.example.com', clientId: 'demo-cli' },
          },
        },
      ],
    };
    fs.writeFileSync(path.join(tmp, 'frontmcp.config.json'), JSON.stringify(config));

    await runBuild({ _: [], buildTarget: 'cli' });

    expect(mockBuildExec).toHaveBeenCalledTimes(1);
    expect(mockBuildExec.mock.calls[0][0].execOverrides.cli).toEqual({
      authRequired: true,
      excludeTools: ['internal_tool'],
      oauth: { serverUrl: 'https://auth.example.com', clientId: 'demo-cli' },
    });
  });
});
