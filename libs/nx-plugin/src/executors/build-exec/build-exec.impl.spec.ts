import { execSync } from 'child_process';
import type { ExecutorContext } from '../executor-context.js';

jest.mock('child_process', () => ({ execSync: jest.fn() }));

import buildExecExecutor from './build-exec.impl';

const mockContext: ExecutorContext = {
  root: '/workspace',
  projectName: 'demo',
  projectsConfigurations: { version: 2, projects: { demo: { root: 'apps/demo' } } },
  cwd: '/workspace',
  isVerbose: false,
  projectGraph: { nodes: {}, dependencies: {} },
  nxJsonConfiguration: {},
};

describe('build-exec executor', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should run frontmcp build --exec', async () => {
    const result = await buildExecExecutor({}, mockContext);
    expect(execSync).toHaveBeenCalledWith('npx frontmcp build --exec', expect.objectContaining({ cwd: '/workspace' }));
    expect(result.success).toBe(true);
  });

  it('should pass entry and outputPath', async () => {
    await buildExecExecutor({ entry: 'src/main.ts', outputPath: 'dist' }, mockContext);
    expect(execSync).toHaveBeenCalledWith(
      'npx frontmcp build --exec --entry src/main.ts --out-dir dist',
      expect.anything(),
    );
  });

  it('should return failure on error', async () => {
    (execSync as jest.Mock).mockImplementation(() => {
      throw new Error('fail');
    });
    const result = await buildExecExecutor({}, mockContext);
    expect(result.success).toBe(false);
  });
});
