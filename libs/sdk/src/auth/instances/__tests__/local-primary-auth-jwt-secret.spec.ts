/**
 * Issue #546 — a production deployment with no `JWT_SECRET` logged
 * "JWT_SECRET is not set, using default secret" and carried on. The fallback is
 * a random 32-byte secret generated once per process, so tokens do not survive
 * a restart and a second instance (or a second Worker isolate) rejects tokens
 * the first one signed. For the modes that actually mint tokens that is a
 * configuration fault, so startup now refuses instead of warning.
 */

import 'reflect-metadata';

import { App } from '../../../common/decorators/app.decorator';
import { FrontMcpInstance } from '../../../front-mcp/front-mcp';

@App({ id: 'jwt-secret-app', name: 'jwt-secret-app' })
class JwtSecretApp {}

/** Run with a specific NODE_ENV / JWT_SECRET pair, restoring both afterwards. */
async function withEnv<T>(env: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const previous = new Map(Object.keys(env).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function createServer(mode: 'public' | 'local'): Promise<FrontMcpInstance> {
  return FrontMcpInstance.createForGraph({
    info: { name: `jwt-secret-${mode}`, version: '0.0.0' },
    apps: [JwtSecretApp],
    auth: mode === 'public' ? { mode: 'public' } : { mode: 'local' },
  });
}

describe('LocalPrimaryAuth JWT secret handling (#546)', () => {
  it('refuses to start a token-minting mode in production without JWT_SECRET', async () => {
    await withEnv({ NODE_ENV: 'production', JWT_SECRET: undefined }, async () => {
      await expect(createServer('local')).rejects.toThrow(/JWT_SECRET is required in production/i);
    });
  });

  it('starts a token-minting mode in production once JWT_SECRET is set', async () => {
    await withEnv({ NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(64) }, async () => {
      const instance = await createServer('local');
      expect(instance.getScopes().length).toBeGreaterThan(0);
      await Promise.all(instance.getScopes().map((scope) => scope.dispose()));
    });
  });

  it('treats a whitespace-only JWT_SECRET as absent rather than using it as the key', async () => {
    await withEnv({ NODE_ENV: 'production', JWT_SECRET: '   ' }, async () => {
      await expect(createServer('local')).rejects.toThrow(/JWT_SECRET is required in production/i);
    });
  });

  it('refuses a JWT_SECRET shorter than HS256 requires in production', async () => {
    await withEnv({ NODE_ENV: 'production', JWT_SECRET: 'short' }, async () => {
      await expect(createServer('local')).rejects.toThrow(/at least 32/i);
    });
  });

  it('accepts a 32-byte secret', async () => {
    await withEnv({ NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(32) }, async () => {
      const instance = await createServer('local');
      expect(instance.getScopes().length).toBeGreaterThan(0);
    });
  });

  it('warns but still boots on a short secret outside production', async () => {
    await withEnv({ NODE_ENV: 'development', JWT_SECRET: 'short' }, async () => {
      const instance = await createServer('local');
      expect(instance.getScopes().length).toBeGreaterThan(0);
    });
  });

  it('leaves development alone so the dev server still boots without a secret', async () => {
    await withEnv({ NODE_ENV: 'development', JWT_SECRET: undefined }, async () => {
      const instance = await createServer('local');
      expect(instance.getScopes().length).toBeGreaterThan(0);
      await Promise.all(instance.getScopes().map((scope) => scope.dispose()));
    });
  });

  it('does not require a secret in public mode, which never mints through this path', async () => {
    await withEnv({ NODE_ENV: 'production', JWT_SECRET: undefined }, async () => {
      const instance = await createServer('public');
      expect(instance.getScopes().length).toBeGreaterThan(0);
      await Promise.all(instance.getScopes().map((scope) => scope.dispose()));
    });
  });
});
