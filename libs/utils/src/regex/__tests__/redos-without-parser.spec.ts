import { analyzePattern, isPatternSafe } from '../safe-regex';

jest.mock('acorn', () => {
  throw new Error('the ReDoS helpers loaded acorn');
});
jest.mock('acorn-walk', () => {
  throw new Error('the ReDoS helpers loaded acorn-walk');
});
jest.mock('astring', () => {
  throw new Error('the ReDoS helpers loaded astring');
});

describe('ReDoS helpers', () => {
  it('analyze patterns with @enclave-vm/ast/redos, without loading its parser', () => {
    expect(isPatternSafe('(a+)+')).toBe(false);
    expect(isPatternSafe('[a-z]+')).toBe(true);
    expect(analyzePattern('(a+)+').safe).toBe(false);
  });
});
