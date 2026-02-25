import { execSync } from 'child_process';

jest.mock('child_process', () => ({
  execSync: jest.fn(),
}));

// Must import after mock setup
import buildExecutor from './build.impl';

const mockContext = {
  root: '/workspace',
  projectName: 'demo',
  projectsConfigurations: {
    version: 2,
    projects: { demo: { root: 'apps/demo' } },
  },
  cwd: '/workspace',
  isVerbose: false,
  projectGraph: { nodes: {}, dependencies: {} },
  nxJsonConfiguration: {},
} as any;

describe('build executor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should run frontmcp build', async () => {
    const result = await buildExecutor({}, mockContext);

    expect(execSync).toHaveBeenCalledWith(
      'npx frontmcp build',
      expect.objectContaining({ cwd: '/workspace' }),
    );
    expect(result.success).toBe(true);
  });

  it('should pass entry and outputPath options', async () => {
    await buildExecutor(
      { entry: 'src/main.ts', outputPath: 'dist', adapter: 'vercel' },
      mockContext,
    );

    expect(execSync).toHaveBeenCalledWith(
      'npx frontmcp build --entry src/main.ts --out-dir dist --adapter vercel',
      expect.anything(),
    );
  });

  it('should return failure on error', async () => {
    (execSync as jest.Mock).mockImplementation(() => {
      throw new Error('Build failed');
    });

    const result = await buildExecutor({}, mockContext);
    expect(result.success).toBe(false);
  });
});
