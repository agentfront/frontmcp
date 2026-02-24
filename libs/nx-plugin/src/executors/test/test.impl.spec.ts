import { execSync } from 'child_process';

jest.mock('child_process', () => ({ execSync: jest.fn() }));

import testExecutor from './test.impl';

const mockContext = {
  root: '/workspace',
  projectName: 'demo',
  projectsConfigurations: { version: 2, projects: { demo: { root: 'apps/demo' } } },
  cwd: '/workspace',
  isVerbose: false,
  projectGraph: { nodes: {}, dependencies: {} },
  nxJsonConfiguration: {},
} as any;

describe('test executor', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should run frontmcp test', async () => {
    const result = await testExecutor({}, mockContext);
    expect(execSync).toHaveBeenCalledWith('npx frontmcp test', expect.anything());
    expect(result.success).toBe(true);
  });

  it('should pass all flags', async () => {
    await testExecutor({ runInBand: true, watch: true, coverage: true, verbose: true, timeout: 30000 }, mockContext);
    expect(execSync).toHaveBeenCalledWith(
      'npx frontmcp test --runInBand --watch --coverage --verbose --timeout 30000',
      expect.anything(),
    );
  });

  it('should return failure on error', async () => {
    (execSync as jest.Mock).mockImplementation(() => {
      throw new Error('fail');
    });
    const result = await testExecutor({}, mockContext);
    expect(result.success).toBe(false);
  });
});
