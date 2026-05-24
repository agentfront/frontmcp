/**
 * Tests for the default-path resolver added in issue #401.
 *
 * Policy under test:
 *  - CLI mode → `~/.{appName}/sessions.sqlite`
 *  - prod env → `~/.{appName}/sessions.sqlite`
 *  - dev + node → `<projectRoot>/dist/sessions.sqlite`
 *  - missing/dirty appName → falls back to `frontmcp` namespace
 */

import { homedir } from 'os';
import * as path from 'path';

// All test paths intentionally use dynamic `require('../resolve')` after
// `jest.resetModules()` so each case rebuilds the cached runtime context
// — no static import is needed.

describe('resolveDefaultSqlitePath', () => {
  const ORIGINAL_NODE_ENV = process.env['NODE_ENV'];

  afterEach(() => {
    if (ORIGINAL_NODE_ENV === undefined) {
      delete process.env['NODE_ENV'];
    } else {
      process.env['NODE_ENV'] = ORIGINAL_NODE_ENV;
    }
    // Clear the cached runtime context between tests so NODE_ENV changes take effect.
    jest.resetModules();
  });

  it('puts the file in <projectRoot>/dist for dev + node + non-CLI', () => {
    process.env['NODE_ENV'] = 'development';
    jest.resetModules();
    // Re-import after resetting modules so the cached runtime context is rebuilt.

    const { resolveDefaultSqlitePath: resolve } = require('../resolve') as typeof import('../resolve');
    const resolved = resolve({ appName: 'my-app', cliMode: false, cwd: process.cwd() });
    // We don't pin the exact projectRoot (it depends on where tests run), but it
    // must end in dist/sessions.sqlite and be absolute.
    expect(path.isAbsolute(resolved)).toBe(true);
    expect(resolved.endsWith(path.join('dist', 'sessions.sqlite'))).toBe(true);
  });

  it('routes prod env to ~/.{appName}/sessions.sqlite', () => {
    process.env['NODE_ENV'] = 'production';
    jest.resetModules();

    const { resolveDefaultSqlitePath: resolve } = require('../resolve') as typeof import('../resolve');
    const resolved = resolve({ appName: 'my-server', cliMode: false });
    expect(resolved).toBe(path.join(homedir(), '.my-server', 'sessions.sqlite'));
  });

  it('routes CLI mode to ~/.{appName}/ regardless of NODE_ENV', () => {
    process.env['NODE_ENV'] = 'development';
    jest.resetModules();

    const { resolveDefaultSqlitePath: resolve } = require('../resolve') as typeof import('../resolve');
    const resolved = resolve({ appName: 'cli-app', cliMode: true });
    expect(resolved).toBe(path.join(homedir(), '.cli-app', 'sessions.sqlite'));
  });

  it('falls back to ~/.frontmcp/ when appName is missing', () => {
    process.env['NODE_ENV'] = 'production';
    jest.resetModules();

    const { resolveDefaultSqlitePath: resolve } = require('../resolve') as typeof import('../resolve');
    const resolved = resolve({ cliMode: false });
    expect(resolved).toBe(path.join(homedir(), '.frontmcp', 'sessions.sqlite'));
  });

  it('sanitizes appName for filesystem safety', () => {
    process.env['NODE_ENV'] = 'production';
    jest.resetModules();

    const { resolveDefaultSqlitePath: resolve } = require('../resolve') as typeof import('../resolve');
    const resolved = resolve({ appName: '@scope/My App!', cliMode: false });
    // '@' becomes '-', '/' becomes '-', ' ' becomes '-', '!' becomes '-'.
    // Leading dashes are stripped so we don't get a hidden dir within ~/.
    expect(resolved).toBe(path.join(homedir(), '.scope-My-App-', 'sessions.sqlite'));
  });

  it('also routes non-node runtimes to the home convention (fail-loud at storage layer)', () => {
    // We can't easily flip the runtime detector here, but the function checks
    // env first. Production env already routes home regardless of runtime, so
    // this exercises the "prod" gate which is the dominant path on non-node.
    process.env['NODE_ENV'] = 'production';
    jest.resetModules();

    const { resolveDefaultSqlitePath: resolve } = require('../resolve') as typeof import('../resolve');
    const resolved = resolve({ appName: 'bun-app', cliMode: false });
    expect(resolved).toBe(path.join(homedir(), '.bun-app', 'sessions.sqlite'));
  });

  it('routes the non-node runtime branch even in dev + non-CLI', () => {
    // The previous test only exercises the prod gate. Force the resolver's
    // dedicated non-node guard by stubbing `getRuntimeContext` so it
    // returns `runtime: 'bun'` while NODE_ENV stays at a non-production
    // value — both `ctx.cliMode || env === 'production'` are false, so
    // execution falls through to the `runtime !== 'node'` branch.
    process.env['NODE_ENV'] = 'development';
    jest.resetModules();
    jest.doMock('@frontmcp/utils', () => {
      const actual = jest.requireActual('@frontmcp/utils') as Record<string, unknown>;
      return {
        ...actual,
        getRuntimeContext: () => ({ runtime: 'bun', env: 'development' }),
      };
    });
    try {
      const { resolveDefaultSqlitePath: resolve } = require('../resolve') as typeof import('../resolve');
      const resolved = resolve({ appName: 'bun-dev', cliMode: false });
      expect(resolved).toBe(path.join(homedir(), '.bun-dev', 'sessions.sqlite'));
    } finally {
      jest.dontMock('@frontmcp/utils');
      jest.resetModules();
    }
  });
});
