import { execSync } from 'child_process';

jest.mock('child_process', () => ({ execSync: jest.fn() }));

import deployExecutor from './deploy.impl';

const mockContext = {
  root: '/workspace',
  projectName: 'server-prod',
  projectsConfigurations: {
    version: 2,
    projects: { 'server-prod': { root: 'servers/prod' } },
  },
  cwd: '/workspace',
  isVerbose: false,
  projectGraph: { nodes: {}, dependencies: {} },
  nxJsonConfiguration: {},
} as any;

describe('deploy executor', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should run docker compose for node target', async () => {
    const result = await deployExecutor({ target: 'node' }, mockContext);
    expect(execSync).toHaveBeenCalledWith(
      'docker compose up --build -d',
      expect.objectContaining({ cwd: '/workspace/servers/prod' }),
    );
    expect(result.success).toBe(true);
  });

  it('should run vercel for vercel target', async () => {
    await deployExecutor({ target: 'vercel' }, mockContext);
    expect(execSync).toHaveBeenCalledWith('npx vercel --prod', expect.anything());
  });

  it('should run sam for lambda target', async () => {
    await deployExecutor({ target: 'lambda' }, mockContext);
    expect(execSync).toHaveBeenCalledWith('sam build && sam deploy', expect.anything());
  });

  it('should run wrangler for cloudflare target', async () => {
    await deployExecutor({ target: 'cloudflare' }, mockContext);
    expect(execSync).toHaveBeenCalledWith('npx wrangler deploy', expect.anything());
  });

  it('should return failure on error', async () => {
    (execSync as jest.Mock).mockImplementation(() => {
      throw new Error('fail');
    });
    const result = await deployExecutor({ target: 'node' }, mockContext);
    expect(result.success).toBe(false);
  });

  it('should return failure for unknown target', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    const result = await deployExecutor({ target: 'unknown' as any }, mockContext);
    expect(result.success).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith('Unknown deployment target: unknown');
    consoleSpy.mockRestore();
  });

  it('should use correct working directory from projectsConfigurations', async () => {
    await deployExecutor({ target: 'node' }, mockContext);
    expect(execSync).toHaveBeenCalledWith(
      'docker compose up --build -d',
      expect.objectContaining({
        cwd: '/workspace/servers/prod',
        stdio: 'inherit',
      }),
    );
  });
});
