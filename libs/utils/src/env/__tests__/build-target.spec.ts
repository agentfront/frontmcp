import { getBuildTarget, resetBuildTargetCacheForTesting } from '../build-target';

describe('getBuildTarget (issue #417)', () => {
  const envBackup = process.env['FRONTMCP_BUILD_TARGET'];
  const globalAny = globalThis as unknown as { FRONTMCP_BUILD_TARGET?: string };

  beforeEach(() => {
    resetBuildTargetCacheForTesting();
    delete globalAny.FRONTMCP_BUILD_TARGET;
    delete process.env['FRONTMCP_BUILD_TARGET'];
  });

  afterAll(() => {
    resetBuildTargetCacheForTesting();
    delete globalAny.FRONTMCP_BUILD_TARGET;
    if (envBackup !== undefined) process.env['FRONTMCP_BUILD_TARGET'] = envBackup;
  });

  it("returns 'unknown' when neither global nor env is set", () => {
    expect(getBuildTarget()).toBe('unknown');
  });

  it('reads globalThis.FRONTMCP_BUILD_TARGET first', () => {
    globalAny.FRONTMCP_BUILD_TARGET = 'cli';
    process.env['FRONTMCP_BUILD_TARGET'] = 'node';
    resetBuildTargetCacheForTesting();
    expect(getBuildTarget()).toBe('cli');
  });

  it('falls back to process.env.FRONTMCP_BUILD_TARGET when global is unset', () => {
    process.env['FRONTMCP_BUILD_TARGET'] = 'vercel';
    resetBuildTargetCacheForTesting();
    expect(getBuildTarget()).toBe('vercel');
  });

  it.each(['node', 'distributed', 'cli', 'vercel', 'lambda', 'cloudflare', 'browser', 'sdk', 'mcpb'])(
    "accepts '%s' as a known target",
    (target) => {
      globalAny.FRONTMCP_BUILD_TARGET = target;
      resetBuildTargetCacheForTesting();
      expect(getBuildTarget()).toBe(target);
    },
  );

  it("returns 'unknown' for unrecognized values", () => {
    globalAny.FRONTMCP_BUILD_TARGET = 'not-a-real-target';
    resetBuildTargetCacheForTesting();
    expect(getBuildTarget()).toBe('unknown');
  });

  it('caches the result across calls', () => {
    globalAny.FRONTMCP_BUILD_TARGET = 'node';
    resetBuildTargetCacheForTesting();
    expect(getBuildTarget()).toBe('node');
    delete globalAny.FRONTMCP_BUILD_TARGET;
    expect(getBuildTarget()).toBe('node');
  });
});
