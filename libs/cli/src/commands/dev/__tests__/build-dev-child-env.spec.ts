/**
 * Unit tests for `buildDevChildEnv` — the env handed to the spawned dev child.
 *
 * Regression coverage for #446: `frontmcp dev` must propagate the configured
 * `transport.http.path` to the server as `FRONTMCP_HTTP_ENTRY_PATH` (the SDK's
 * `http.entryPath` default reads it), so the MCP endpoint is mounted where the
 * generated client URLs point instead of always at `/`. The dev-resolved port
 * and path must win over inherited env, mirroring the documented `PORT` behavior.
 *
 * (The SDK end — that this env actually moves the mounted endpoint — is covered
 * e2e by apps/e2e/demo-e2e-standalone/e2e/entry-path-env.e2e.spec.ts. We don't
 * e2e the full `frontmcp dev` spawn here because it shells out to `npx tsx`,
 * which is a network/cold-start dependency, not part of this logic.)
 */
import { buildDevChildEnv } from '../dev';

describe('buildDevChildEnv (#446)', () => {
  it('propagates configHttpPath as FRONTMCP_HTTP_ENTRY_PATH', () => {
    const env = buildDevChildEnv({ effectiveEnv: {}, baseEnv: {}, port: 3000, configHttpPath: '/mcp' });
    expect(env['FRONTMCP_HTTP_ENTRY_PATH']).toBe('/mcp');
    expect(env['PORT']).toBe('3000');
  });

  it('omits FRONTMCP_HTTP_ENTRY_PATH when no path is configured', () => {
    const env = buildDevChildEnv({ effectiveEnv: {}, baseEnv: {}, port: 3000, configHttpPath: undefined });
    expect('FRONTMCP_HTTP_ENTRY_PATH' in env).toBe(false);
  });

  it('propagates an explicit empty-string path (root) rather than dropping it', () => {
    const env = buildDevChildEnv({ effectiveEnv: {}, baseEnv: {}, port: 3000, configHttpPath: '' });
    expect(env['FRONTMCP_HTTP_ENTRY_PATH']).toBe('');
  });

  it('exports the resolved port as a stringified PORT', () => {
    const env = buildDevChildEnv({ effectiveEnv: {}, baseEnv: {}, port: 4567 });
    expect(env['PORT']).toBe('4567');
  });

  it('lets the dev-resolved port and path win over inherited env', () => {
    const env = buildDevChildEnv({
      effectiveEnv: { PORT: '1111', FRONTMCP_HTTP_ENTRY_PATH: '/from-config-overlay' },
      baseEnv: { PORT: '2222', FRONTMCP_HTTP_ENTRY_PATH: '/from-shell' },
      port: 3000,
      configHttpPath: '/mcp',
    });
    expect(env['PORT']).toBe('3000');
    expect(env['FRONTMCP_HTTP_ENTRY_PATH']).toBe('/mcp');
  });

  it('merges env with baseEnv (process.env) overriding the config overlay', () => {
    const env = buildDevChildEnv({
      effectiveEnv: { SHARED: 'overlay', ONLY_OVERLAY: 'a' },
      baseEnv: { SHARED: 'process', ONLY_BASE: 'b' },
      port: 3000,
    });
    expect(env['SHARED']).toBe('process'); // baseEnv wins
    expect(env['ONLY_OVERLAY']).toBe('a');
    expect(env['ONLY_BASE']).toBe('b');
  });

  it('inherits FRONTMCP_HTTP_ENTRY_PATH from env when no config path is given', () => {
    const env = buildDevChildEnv({
      effectiveEnv: {},
      baseEnv: { FRONTMCP_HTTP_ENTRY_PATH: '/from-shell' },
      port: 3000,
      configHttpPath: undefined,
    });
    expect(env['FRONTMCP_HTTP_ENTRY_PATH']).toBe('/from-shell');
  });
});
