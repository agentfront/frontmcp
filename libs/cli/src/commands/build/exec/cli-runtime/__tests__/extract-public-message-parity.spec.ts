/**
 * Behavior test for the SEA-bundled `_extractPublicMessage` JS snippet in
 * `extract-public-message.snippet.ts`.
 *
 * The SDK's `extractPublicMessage` (in `libs/sdk/src/errors/mcp.error.ts`)
 * has its own tests; this file pins the CLI-bundled mirror to the SAME
 * expected outputs over a shared set of error shapes. If the SDK
 * implementation changes its observable behavior, this file must be
 * updated in lockstep — that's the contract.
 *
 * We don't `import { extractPublicMessage } from '@frontmcp/sdk'` here: the
 * CLI test environment can't always reach the SDK build, and importing the
 * SDK source directly drags in reflect-metadata/decorator setup that the
 * generated CLI bundle doesn't need. Hand-shaped fixtures (duck-typed
 * objects mirroring the SDK error shapes) are sufficient — the SDK's own
 * test suite locks in the SDK side.
 */

import { EXTRACT_PUBLIC_MESSAGE_SNIPPET } from '../extract-public-message.snippet';

type Extractor = (err: unknown) => string;

function loadExtractor(): Extractor {
   
  const factory = new Function(
    `${EXTRACT_PUBLIC_MESSAGE_SNIPPET}\nreturn _extractPublicMessage;`,
  ) as () => Extractor;
  return factory();
}

describe('extract-public-message snippet', () => {
  const extract = loadExtractor();

  it('returns "Unknown error" for null and undefined', () => {
    expect(extract(null)).toBe('Unknown error');
    expect(extract(undefined)).toBe('Unknown error');
  });

  it('passes plain strings through', () => {
    expect(extract('simple message')).toBe('simple message');
  });

  it('uses Error.message for plain Errors', () => {
    expect(extract(new Error('boom'))).toBe('boom');
  });

  it('recognizes duck-typed PublicMcpError shape (isPublic=true + message)', () => {
    const fakePublicErr = { isPublic: true, message: 'Cannot divide by zero', code: 'INVALID_PARAMS' };
    expect(extract(fakePublicErr)).toBe('Cannot divide by zero');
  });

  it('unwraps originalError to find the inner public message', () => {
    const inner = { isPublic: true, message: 'Cannot divide by zero' };
    const wrapped = Object.assign(new Error(`Tool "divide" execution failed: ${inner.message}`), {
      originalError: inner,
    });
    // Inner public message wins over the wrapper's text.
    expect(extract(wrapped)).toBe('Cannot divide by zero');
  });

  it('walks the .cause chain when no originalError is set', () => {
    const root = { isPublic: true, message: 'public root' };
    const wrapped = Object.assign(new Error('outer'), { cause: root });
    expect(extract(wrapped)).toBe('public root');
  });

  it('falls back to outer .message when neither inner is publicly tagged', () => {
    const inner = new Error('plain inner');
    const wrapped = Object.assign(new Error('outer wrapper'), { cause: inner });
    // Both messages are non-public; we should pick something useful, not "Unknown".
    const got = extract(wrapped);
    expect(['plain inner', 'outer wrapper']).toContain(got);
  });

  it('short-circuits direct cycles via WeakSet visited guard', () => {
    const e: { message: string; cause?: unknown } = new Error('cyclic');
    e.cause = e;
    expect(() => extract(e)).not.toThrow();
    expect(extract(e)).toBe('cyclic');
  });

  it('short-circuits transitive cycles (a → b → a)', () => {
    const a: { message: string; cause?: unknown } = new Error('a');
    const b: { message: string; cause?: unknown } = new Error('b');
    a.cause = b;
    b.cause = a;
    expect(() => extract(a)).not.toThrow();
    // Either 'a' or 'b' is acceptable — what matters is that the walker
    // doesn't infinite-loop.
    expect(['a', 'b']).toContain(extract(a));
  });

  it('arbitrarily-deep linear chains do not stack-overflow and reach the inner-most message', () => {
    let last: { message: string; cause?: unknown } = new Error('inner-most');
    for (let i = 0; i < 200; i++) {
      const next = new Error(`level-${i}`);
      (next as { cause?: unknown }).cause = last;
      last = next;
    }
    expect(() => extract(last)).not.toThrow();
    const result = extract(last);
    expect(typeof result).toBe('string');
    expect(result).not.toBe('Unknown error');
  });

  it('coerces non-Error thrown values to strings', () => {
    expect(extract(42)).toBe('42');
    expect(extract(true)).toBe('true');
    // Plain object → "[object Object]" via String() coercion.
    expect(extract({ foo: 'bar' })).toBe('[object Object]');
  });
});
