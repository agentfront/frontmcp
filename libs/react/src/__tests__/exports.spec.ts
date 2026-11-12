/** @jest-environment node */
import { EventContext as SdkEventContext } from '@frontmcp/sdk';

import { EventContext, z } from '../index';

describe('@frontmcp/react root exports', () => {
  it('re-exports zod as z so tool schemas need no second zod install', () => {
    expect(z.string().parse('x')).toBe('x');
    expect(() => z.number().parse('x')).toThrow();
  });

  it('re-exports EventContext, the base class of an @Event class', () => {
    expect(EventContext).toBe(SdkEventContext);
  });
});
