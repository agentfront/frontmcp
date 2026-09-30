import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';

import { authProviderGenerator } from './auth-provider';

describe('auth-provider generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    addProjectConfiguration(tree, 'my-app', {
      root: 'apps/my-app',
      sourceRoot: 'apps/my-app/src',
      projectType: 'application',
    });
  });

  it('should generate an auth provider file', async () => {
    await authProviderGenerator(tree, { name: 'github', project: 'my-app', skipFormat: true });

    expect(tree.exists('apps/my-app/src/auth/github.auth-provider.ts')).toBe(true);
  });

  it('should use bearer type by default', async () => {
    await authProviderGenerator(tree, { name: 'github', project: 'my-app', skipFormat: true });

    const content = tree.read('apps/my-app/src/auth/github.auth-provider.ts', 'utf-8');
    expect(content).toContain('Bearer ${token}');
    expect(content).toContain('Bearer');
  });

  it('should generate api-key auth provider', async () => {
    await authProviderGenerator(tree, { name: 'stripe', project: 'my-app', type: 'api-key', skipFormat: true });

    const content = tree.read('apps/my-app/src/auth/stripe.auth-provider.ts', 'utf-8');
    expect(content).toContain("'X-API-Key': apiKey");
    expect(content).toContain('X-API-Key');
  });

  it('should generate oauth auth provider with refreshToken', async () => {
    await authProviderGenerator(tree, { name: 'google', project: 'my-app', type: 'oauth', skipFormat: true });

    const content = tree.read('apps/my-app/src/auth/google.auth-provider.ts', 'utf-8');
    expect(content).toContain('async refreshToken()');
    expect(content).toContain('refreshToken');
  });

  it('should generate basic auth provider', async () => {
    await authProviderGenerator(tree, { name: 'legacy', project: 'my-app', type: 'basic', skipFormat: true });

    const content = tree.read('apps/my-app/src/auth/legacy.auth-provider.ts', 'utf-8');
    expect(content).toContain('Basic ${encoded}');
    expect(content).toContain('Basic');
  });

  it('should use correct class name', async () => {
    await authProviderGenerator(tree, { name: 'github', project: 'my-app' });

    const content = tree.read('apps/my-app/src/auth/github.auth-provider.ts', 'utf-8');
    expect(content).toContain('class GithubAuthProvider');
  });

  it('should export default', async () => {
    const mod = await import('./auth-provider');
    expect(mod.default).toBe(authProviderGenerator);
  });
});
