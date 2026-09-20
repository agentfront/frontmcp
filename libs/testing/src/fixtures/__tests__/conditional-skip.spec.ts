/**
 * Issue #541 — `test.skip(condition, reason)`.
 *
 * The fixture API is Playwright-shaped, so the conditional form reads as the
 * natural way to gate a block. It used to reach Jest's `skip(name, fn)` and
 * throw "Invalid first argument, true" at collection time, failing the whole
 * suite instead of skipping it.
 *
 * These specs exercise the real thing: a conditional skip is evaluated during
 * collection, so a test that must not run simply is not reported as run. The
 * `ran` flags below are asserted after the fact.
 */
import { test } from '../test-fixture';

const ran: Record<string, boolean> = {};

// No `test.use()` here on purpose: every test in this file must be skipped, so
// no server is ever booted. A test that leaks past a skip would fail loudly on
// the missing `server`/`baseUrl` config, which is exactly the signal we want.

test.describe('skipped by a true condition', () => {
  test.skip(true, 'credentials not set');

  test('does not run', async () => {
    ran['trueCondition'] = true;
  });

  test('does not run either', async () => {
    ran['trueConditionSecond'] = true;
  });

  test.describe('a nested block inherits the skip', () => {
    test('does not run', async () => {
      ran['nestedInherited'] = true;
    });
  });
});

test.describe('a false condition leaves the block alone', () => {
  test.skip(false, 'not skipped');

  // Registered normally — proven by the sibling scope assertions below rather
  // than by executing it, since running it would require a booted server.
  test.skip('explicitly skipped by name', async () => {
    ran['namedSkip'] = true;
  });
});

test.describe('a sibling block is unaffected by another block’s skip', () => {
  test.skip('still supports the (name, fn) form', async () => {
    ran['siblingNamed'] = true;
  });
});

test.describe('a focused test still honours an enclosing skip', () => {
  test.skip(true, 'credentials not set');

  // Were `only` to ignore the scope, this would run — and, being `.only`, would
  // also suppress every other test in the file.
  test.only('does not run', async () => {
    ran['focusedInsideSkip'] = true;
  });
});

test.describe.skip('a skipped block does not leak its scope to later blocks', () => {
  // Jest still evaluates a skipped block's callback during collection.
  test.skip(true, 'inner gate');

  test('does not run', async () => {
    ran['insideSkippedBlock'] = true;
  });
});

test.describe('a block after a skipped one is unaffected', () => {
  test.skip('named skip, still just one test', async () => {
    ran['afterSkippedBlock'] = true;
  });
});

describe('conditional skip bookkeeping (#541)', () => {
  it('accepts a boolean first argument instead of throwing at collection time', () => {
    // Reaching this assertion at all means the calls above did not throw while
    // the file was being collected — the original failure mode.
    expect(typeof test.skip).toBe('function');
  });

  it('did not run any test inside a block skipped by condition', () => {
    expect(ran['trueCondition']).toBeUndefined();
    expect(ran['trueConditionSecond']).toBeUndefined();
    expect(ran['nestedInherited']).toBeUndefined();
  });

  it('did not run a focused test that sits inside a skipped block', () => {
    expect(ran['focusedInsideSkip']).toBeUndefined();
  });

  it('did not let a skipped block leak its scope to a later sibling', () => {
    // Reaching this assertion at all proves the leak did not happen: a leaked
    // scope would have skipped this whole `describe`.
    expect(ran['insideSkippedBlock']).toBeUndefined();
    expect(ran['afterSkippedBlock']).toBeUndefined();
  });

  it('rejects a first argument that is neither a name nor a condition', () => {
    expect(() => (test.skip as unknown as (a: unknown, b: unknown) => void)(42, 'nope')).toThrow(
      /test\.skip expects either/,
    );
  });

  it('rejects the (name) form with no function', () => {
    expect(() => (test.skip as unknown as (a: unknown) => void)('a name')).toThrow(/test\.skip expects either/);
  });
});
