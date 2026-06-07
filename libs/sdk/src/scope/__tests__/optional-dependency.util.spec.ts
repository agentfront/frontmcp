/**
 * Tests for probeOptionalDependency — the classifier behind the
 * `@frontmcp/observability` "not installed" warning (#453).
 *
 * The bug: a failed `require('@frontmcp/observability')` was always reported as
 * "not installed", even when the package was installed and resolvable but threw
 * while loading (an export-condition / transpile / peer mismatch under tsx+yarn).
 * The classifier re-probes with the runtime resolver to tell the two apart.
 */

import { probeOptionalDependency } from '../optional-dependency.util';

describe('probeOptionalDependency (#453)', () => {
  it('reports "not-installed" when the module cannot be resolved', () => {
    const resolve = jest.fn(() => {
      throw new Error("Cannot find module 'pkg'");
    });

    const probe = probeOptionalDependency('pkg', new Error('Cannot find module'), resolve);

    expect(probe.status).toBe('not-installed');
    expect(probe.resolvedPath).toBeUndefined();
    expect(resolve).toHaveBeenCalledWith('pkg');
  });

  it('reports "load-failed" with the resolved path when the module resolves but require() threw', () => {
    const resolve = jest.fn(() => '/app/node_modules/@frontmcp/observability/index.js');
    const loadError = new Error('Unexpected token (TS source loaded under CJS)');

    const probe = probeOptionalDependency('@frontmcp/observability', loadError, resolve);

    expect(probe.status).toBe('load-failed');
    expect(probe.resolvedPath).toBe('/app/node_modules/@frontmcp/observability/index.js');
    expect(probe.error).toBe('Unexpected token (TS source loaded under CJS)');
  });

  it('preserves the original error message verbatim', () => {
    const resolve = jest.fn(() => '/app/node_modules/pkg/index.js');

    const probe = probeOptionalDependency('pkg', new Error('boom: missing peer winston'), resolve);

    expect(probe.error).toBe('boom: missing peer winston');
  });

  it('stringifies non-Error load failures', () => {
    const resolve = jest.fn(() => {
      throw new Error('not found');
    });

    const probe = probeOptionalDependency('pkg', 'plain string failure', resolve);

    expect(probe.status).toBe('not-installed');
    expect(probe.error).toBe('plain string failure');
  });

  it('does not include resolvedPath on the not-installed result shape', () => {
    const resolve = jest.fn(() => {
      throw new Error('nope');
    });

    const probe = probeOptionalDependency('pkg', new Error('x'), resolve);

    expect('resolvedPath' in probe).toBe(false);
  });
});
