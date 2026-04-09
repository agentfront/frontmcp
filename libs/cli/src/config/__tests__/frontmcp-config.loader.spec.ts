import { findDeployment, getDeploymentTargets, validateConfig } from '../frontmcp-config.loader';

describe('validateConfig', () => {
  it('should validate and return parsed config', () => {
    const config = validateConfig({
      name: 'test-server',
      deployments: [{ target: 'node' }],
    });
    expect(config.name).toBe('test-server');
    expect(config.deployments).toHaveLength(1);
  });

  it('should throw on invalid config with readable message', () => {
    expect(() =>
      validateConfig({
        name: '',
        deployments: [],
      }),
    ).toThrow('Invalid frontmcp.config');
  });

  it('should preserve server config with http inside deployment', () => {
    const config = validateConfig({
      name: 'test',
      deployments: [
        {
          target: 'distributed',
          server: { http: { port: 8080 }, cookies: { affinity: '__myapp' } },
        },
      ],
    });
    const deployment = config.deployments[0] as {
      server?: { http?: { port?: number }; cookies?: { affinity?: string } };
    };
    expect(deployment.server?.http?.port).toBe(8080);
    expect(deployment.server?.cookies?.affinity).toBe('__myapp');
  });

  it('should allow browser deployment without server config', () => {
    const config = validateConfig({
      name: 'test',
      deployments: [{ target: 'browser' }],
    });
    expect(config.deployments[0].target).toBe('browser');
    expect((config.deployments[0] as Record<string, unknown>)['server']).toBeUndefined();
  });
});

describe('findDeployment', () => {
  const config = validateConfig({
    name: 'test',
    deployments: [{ target: 'distributed' }, { target: 'cli' }, { target: 'browser' }],
  });

  it('should find existing target', () => {
    expect(findDeployment(config, 'cli')?.target).toBe('cli');
  });

  it('should return undefined for missing target', () => {
    expect(findDeployment(config, 'vercel')).toBeUndefined();
  });
});

describe('getDeploymentTargets', () => {
  it('should return all target types', () => {
    const config = validateConfig({
      name: 'test',
      deployments: [{ target: 'distributed' }, { target: 'cli' }, { target: 'browser' }],
    });
    expect(getDeploymentTargets(config)).toEqual(['distributed', 'cli', 'browser']);
  });
});
