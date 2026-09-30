/** @jest-environment node */
import { z } from '../index';

describe('@frontmcp/react root exports', () => {
  it('re-exports zod as z so tool schemas need no second zod install', () => {
    expect(z.string().parse('x')).toBe('x');
    expect(() => z.number().parse('x')).toThrow();
  });
});
