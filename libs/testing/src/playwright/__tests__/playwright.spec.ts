import { expect as playwrightExpect, test as playwrightTest } from '../index';

const pointsToAlternatives = expect.objectContaining({
  message: expect.stringMatching(
    /@frontmcp\/testing\/playwright is not implemented\. .*`@playwright\/test`.*`TestServer\.start\(\)`.*`MockOAuthServer`/,
  ),
});

describe('@frontmcp/testing/playwright', () => {
  it.each([
    ['test(name, fn)', () => playwrightTest('flow', async () => undefined)],
    [
      'test.describe(name, fn)',
      () => (playwrightTest as unknown as { describe: (name: string) => void }).describe('flow'),
    ],
    ['test.use(options)', () => (playwrightTest as unknown as { use: (options: object) => void }).use({ server: {} })],
    ['expect(value)', () => (playwrightExpect as unknown as (value: unknown) => unknown)(1)],
    ['expect.soft(value)', () => (playwrightExpect as unknown as { soft: (value: unknown) => unknown }).soft(1)],
  ])('%s throws a message naming what to use instead', (_usage, use) => {
    expect(use).toThrow(pointsToAlternatives);
  });

  it('still loads, so importing it is not an error', () => {
    expect(playwrightExpect.notImplemented).toBe(true);
    expect(typeof playwrightTest).toBe('function');
  });
});
