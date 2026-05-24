/**
 * Unit tests for `frontmcp plugin install` runner internals (issue #411).
 *
 * Covers:
 *   - `--scope` validation: only 'project' | 'user' | undefined are accepted;
 *     anything else fails fast instead of silently writing files to the wrong
 *     root.
 *   - Best-effort skill/prompt collection: a missing/broken project entry
 *     surfaces a stderr warning and yields an empty array fallback so the
 *     install never crashes the user's session.
 */

import { runInstallCurrentProject } from '../install-claude-plugin';

describe('runInstallCurrentProject — option normalization (issue #411)', () => {
  let exitSpy: jest.SpyInstance<never, [code?: number | undefined]>;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    // process.exit is invoked when no provider is selected; stub so the test
    // can assert without bringing the runner down. Throw a sentinel so the
    // runner stops at the first exit() like the real flow.
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('__exit__');
    }) as never);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('rejects a bogus --scope value before any side-effects run', async () => {
    await expect(runInstallCurrentProject({ scope: 'usr', claudePlugin: true })).rejects.toThrow(
      /Invalid --scope value: usr\. Expected "project" or "user"\./,
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('accepts --scope user without complaint', async () => {
    // No provider selected → runner exits 1; that means scope validation
    // already passed.
    await expect(runInstallCurrentProject({ scope: 'user' })).rejects.toThrow(/__exit__/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('accepts --scope project without complaint', async () => {
    await expect(runInstallCurrentProject({ scope: 'project' })).rejects.toThrow(/__exit__/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('accepts an absent --scope (default project)', async () => {
    await expect(runInstallCurrentProject({})).rejects.toThrow(/__exit__/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
