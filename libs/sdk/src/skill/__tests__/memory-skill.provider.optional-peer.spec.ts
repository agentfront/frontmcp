/**
 * Regression guard: `vectoriadb` is an OPTIONAL peer of the SDK and MUST be
 * loaded lazily (issue 05 — "SDK eagerly imports its optional peer vectoriadb").
 *
 * The original bug: `memory-skill.provider.ts` had a top-level value import
 * (`import { TFIDFVectoria } from 'vectoriadb'`) that sat in the SDK's main
 * entry. Because the peer is declared `optional` (npm does not auto-install it),
 * every *standalone* consumer that never touched skills crashed at boot with:
 *
 *   Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vectoriadb'
 *     imported from .../node_modules/@frontmcp/sdk/esm/index.mjs
 *
 * The contract this file pins down:
 *   1. Loading the provider module never requires the peer (no boot crash).
 *   2. Constructing and initializing the provider, and registering, listing and
 *      loading skills, never load the peer — only a search does (issue #680:
 *      every app builds a skill registry at boot, so loading it there made
 *      every server depend on it).
 *   3. The first *search* surfaces a clear, actionable install hint — not an
 *      opaque module-resolution error.
 *   4. Teardown (`clear`/`dispose`) stays resilient when the peer is absent.
 *
 * We simulate "peer not installed" by mocking `vectoriadb` to throw on load,
 * which is exactly what the runtime does when an optional peer is missing.
 */

// Hoisted by @swc/jest above the imports below — every test in this file runs
// as if `vectoriadb` were not installed (the factory throws on require()).
jest.mock('vectoriadb', () => {
  throw new Error("Cannot find package 'vectoriadb' (ERR_MODULE_NOT_FOUND)");
});

import { MemorySkillProvider } from '../providers/memory-skill.provider';
import { SkillContent } from '../../common/interfaces';

const createTestSkill = (): SkillContent => ({
  id: 'guard-skill',
  name: 'Guard Skill',
  description: 'A skill used to exercise the optional-peer guard',
  instructions: 'Step 1: do nothing',
  tools: [{ name: 'tool1' }],
});

// The on-use error must name the optional peer so the failure is actionable.
// Exact per-branch wording (not-installed vs failed-to-load) is covered by the
// importOptionalPeer tests in optional-dependency.util.spec.ts.
const PEER_ERROR = /vectoriadb/;

describe('MemorySkillProvider — optional peer `vectoriadb` (issue 05)', () => {
  it('does not require the optional peer at module-evaluation time (no boot crash)', () => {
    // If the provider regressed to a top-level value import of `vectoriadb`,
    // evaluating the module under the throwing mock would throw here — which is
    // precisely the ERR_MODULE_NOT_FOUND that crashed standalone installs.
    expect(() => {
      jest.isolateModules(() => {
        require('../providers/memory-skill.provider');
      });
    }).not.toThrow();
  });

  it('constructs without throwing even when the peer is unavailable', () => {
    expect(() => new MemorySkillProvider()).not.toThrow();
  });

  it('constructed-but-unused provider does not raise an unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      new MemorySkillProvider();
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });

  it('initialize() does not load the peer: a server whose skills are never searched boots without it', async () => {
    const provider = new MemorySkillProvider();
    await expect(provider.initialize()).resolves.toBeUndefined();
  });

  it('add(), list(), load() and count() work without the peer', async () => {
    const provider = new MemorySkillProvider();
    await provider.initialize();
    await provider.add(createTestSkill());
    expect((await provider.list()).skills.map((s) => s.name)).toEqual(['Guard Skill']);
    expect((await provider.load('guard-skill'))?.skill.name).toBe('Guard Skill');
    expect(await provider.count()).toBe(1);
  });

  it('search() surfaces the same clear install hint on first use', async () => {
    const provider = new MemorySkillProvider();
    await expect(provider.search('anything')).rejects.toThrow(PEER_ERROR);
  });

  it('warm() surfaces the same clear install hint (it builds the search index)', async () => {
    const provider = new MemorySkillProvider();
    await provider.add(createTestSkill());
    await expect(provider.warm()).rejects.toThrow(PEER_ERROR);
  });

  it('clear() stays resilient (resolves) when the peer is absent', async () => {
    const provider = new MemorySkillProvider();
    await expect(provider.clear()).resolves.toBeUndefined();
  });

  it('dispose() stays resilient (resolves) when the peer is absent', async () => {
    const provider = new MemorySkillProvider();
    await expect(provider.dispose()).resolves.toBeUndefined();
  });
});
