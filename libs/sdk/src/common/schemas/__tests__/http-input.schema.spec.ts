import { z } from '@frontmcp/lazy-zod';

import { httpInputSchema, httpRequestInputSchema } from '../http-input.schema';

const passthroughInputSchema = z.object({
  request: z.object({}).passthrough(),
  response: z.object({}).passthrough(),
  next: z.function().optional(),
});

class FakeRequest {
  headers = { accept: 'application/json' };
  body = { method: 'tools/call' };
  get(name: string) {
    return (this.headers as Record<string, string>)[name];
  }
}

describe('httpInputSchema', () => {
  it('passes the request and response objects through without copying them', () => {
    const request = new FakeRequest();
    const response = { statusCode: 200 };
    const parsed = httpInputSchema.parse({ request, response });
    expect(parsed.request).toBe(request);
    expect(parsed.response).toBe(response);
  });

  it('passes the request through in httpRequestInputSchema and its extensions', () => {
    const request = new FakeRequest();
    expect(httpRequestInputSchema.parse({ request }).request).toBe(request);
    const extended = httpRequestInputSchema.extend({ sessionless: z.boolean().optional() });
    expect(extended.parse({ request, sessionless: true })).toEqual({ request, sessionless: true });
  });

  it.each([
    ['a string', 'request'],
    ['null', null],
    ['an array', []],
    ['a number', 5],
    ['undefined', undefined],
  ])('rejects %s with the issue a passthrough object reports', (_label, value) => {
    const input = { request: value, response: value };
    const actual = httpInputSchema.safeParse(input);
    const expected = passthroughInputSchema.safeParse(input);
    expect(actual.success).toBe(false);
    expect(expected.success).toBe(false);
    expect(actual.error?.issues).toEqual(expected.error?.issues);
  });

  it('still rejects a next that is not a function', () => {
    const result = httpInputSchema.safeParse({ request: {}, response: {}, next: 'nope' });
    expect(result.success).toBe(false);
  });
});
