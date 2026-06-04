/**
 * Unit tests for the shared {@link captureCallerDir} / {@link parseCallerDir}
 * call-site capture helper used by the `@Skill` / `@FrontMcp` / `@App` decorator
 * factories to anchor relative file paths to the user's defining module.
 */
import { dirname } from '@frontmcp/utils';

import { captureCallerDir, parseCallerDir } from '../caller-dir.utils';

describe('parseCallerDir (pure stack parser)', () => {
  it('always self-skips caller-dir.utils.ts; first non-skipped frame wins', () => {
    const stack = [
      'Error',
      '    at captureCallerDir (/abs/path/sdk/src/common/utils/caller-dir.utils.ts:43:15)',
      '    at FrontMcp (/abs/path/sdk/src/common/decorators/front-mcp.decorator.ts:76:21)',
      '    at Object.<anonymous> (/abs/path/user/src/server.ts:12:1)',
      '    at Module._compile (node:internal/modules/cjs/loader:1356:14)',
    ].join('\n');
    // caller-dir.utils.ts is ALWAYS skipped (it sits between the factory and the
    // user frame); with no other skip the decorator frame is next.
    expect(parseCallerDir(stack)).toBe('/abs/path/sdk/src/common/decorators');
  });

  it('skips a caller-supplied basename so the user frame wins', () => {
    const stack = [
      'Error',
      '    at captureCallerDir (/abs/path/sdk/src/common/utils/caller-dir.utils.ts:43:15)',
      '    at FrontMcp (/abs/path/sdk/src/common/decorators/front-mcp.decorator.ts:76:21)',
      '    at Object.<anonymous> (/abs/path/user/src/server.ts:12:1)',
    ].join('\n');
    expect(parseCallerDir(stack, ['caller-dir.utils.ts', 'front-mcp.decorator.ts'])).toBe('/abs/path/user/src');
  });

  it('returns the dirname of the first user ESM frame (file:// URL)', () => {
    const stack = [
      'Error',
      '    at FrontMcp (/abs/path/sdk/src/common/decorators/front-mcp.decorator.ts:76:21)',
      '    at file:///abs/path/user/src/server.ts:12:1',
      '    at ModuleJob.run (node:internal/modules/esm/module_job:218:25)',
    ].join('\n');
    expect(parseCallerDir(stack, ['front-mcp.decorator.ts'])).toBe(dirname('/abs/path/user/src/server.ts'));
  });

  it('skips node_modules frames', () => {
    const stack = [
      'Error',
      '    at someHelper (/abs/path/node_modules/some-lib/index.js:42:7)',
      '    at Object.<anonymous> (/abs/path/user/src/server.ts:12:1)',
    ].join('\n');
    expect(parseCallerDir(stack)).toBe('/abs/path/user/src');
  });

  it('skips @frontmcp/ and /dist/ framework frames', () => {
    const stack = [
      'Error',
      '    at FrontMcp (/repo/node_modules/@frontmcp/sdk/dist/decorators.js:1:1)',
      '    at boot (/repo/libs/sdk/dist/cjs/front-mcp/instance.js:1:1)',
      '    at Object.<anonymous> (/repo/user/app.ts:9:1)',
    ].join('\n');
    expect(parseCallerDir(stack)).toBe('/repo/user');
  });

  it('skips node: internal frames', () => {
    const stack = [
      'Error',
      '    at processTicksAndRejections (node:internal/process/task_queues:104:5)',
      '    at Object.<anonymous> (/abs/path/user/src/server.ts:12:1)',
    ].join('\n');
    expect(parseCallerDir(stack)).toBe('/abs/path/user/src');
  });

  it('matches by basename, NOT substring (foo.decorator.spec.ts is not skipped)', () => {
    const stack = [
      'Error',
      '    at FrontMcp (/abs/path/sdk/src/common/decorators/front-mcp.decorator.ts:76:21)',
      '    at Object.<anonymous> (/abs/path/sdk/src/__tests__/front-mcp.decorator.spec.ts:50:1)',
    ].join('\n');
    expect(parseCallerDir(stack, ['front-mcp.decorator.ts'])).toBe('/abs/path/sdk/src/__tests__');
  });

  it('returns undefined for an undefined stack', () => {
    expect(parseCallerDir(undefined)).toBeUndefined();
  });

  it('returns undefined when no user frames are present', () => {
    const stack = [
      'Error',
      '    at FrontMcp (/abs/path/node_modules/@frontmcp/sdk/dist/x.js:1:1)',
      '    at processTicksAndRejections (node:internal/process/task_queues:104:5)',
    ].join('\n');
    expect(parseCallerDir(stack, ['x.js'])).toBeUndefined();
  });

  it('caps iteration at 30 frames', () => {
    const lines = ['Error'];
    for (let i = 0; i < 50; i++) {
      lines.push(
        i === 34
          ? '    at Object.<anonymous> (/abs/path/user/src/late.ts:1:1)'
          : '    at internal (/abs/path/node_modules/x/index.js:1:1)',
      );
    }
    expect(parseCallerDir(lines.join('\n'))).toBeUndefined();
  });

  it('ignores absurdly long lines (ReDoS guard)', () => {
    const longLine = '    at x (' + 'a'.repeat(3000) + ':1:1)';
    const stack = ['Error', longLine, '    at Object.<anonymous> (/abs/path/user/src/server.ts:12:1)'].join('\n');
    expect(parseCallerDir(stack)).toBe('/abs/path/user/src');
  });
});

describe('captureCallerDir (live stack)', () => {
  it('returns this spec file directory when called directly (no skip)', () => {
    // The first user frame is THIS spec file; nothing here is framework-skipped.
    const dir = captureCallerDir();
    expect(dir).toBeDefined();
    expect(dir).toContain('__tests__');
  });

  it('returns undefined-safe value without throwing', () => {
    expect(() => captureCallerDir(['nonexistent.ts'])).not.toThrow();
  });
});
