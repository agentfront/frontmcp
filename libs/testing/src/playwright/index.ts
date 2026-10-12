/**
 * @file playwright/index.ts
 * @description Not implemented: a Playwright integration for OAuth flow testing is planned.
 *
 * `test` and `expect` from this entry point throw when called or used (`test.describe`, `test.use`,
 * `expect(value)`), with a message naming what to use instead:
 * - Browser tests: `test` and `expect` from `@playwright/test`, against a server started with
 *   `TestServer.start()` from `@frontmcp/testing`.
 * - OAuth flows without a browser: `MockOAuthServer` and `TestTokenFactory` from `@frontmcp/testing`.
 */

const PLAYWRIGHT_NOT_IMPLEMENTED_MESSAGE =
  '@frontmcp/testing/playwright is not implemented. For browser tests, use `test` and `expect` from ' +
  '`@playwright/test` against a server started with `TestServer.start()` from `@frontmcp/testing`. ' +
  'For OAuth flows without a browser, use `MockOAuthServer` and `TestTokenFactory` from `@frontmcp/testing`.';

function notImplemented(): never {
  throw new Error(PLAYWRIGHT_NOT_IMPLEMENTED_MESSAGE);
}

/** Throws the not-implemented message when called, and when any member it doesn't have is read. */
function notImplementedApi<T extends (...args: never[]) => unknown>(target: T): T {
  return new Proxy(target, {
    apply: notImplemented,
    get: (api, property) =>
      typeof property === 'string' && !(property in api) ? notImplemented() : Reflect.get(api, property),
  });
}

export const playwrightIntegration = {
  version: '0.4.0',
  status: 'planned',
  description: 'Playwright integration for OAuth flow testing - not implemented',
};

export const test = notImplementedApi((_name: string, _fn: () => Promise<void>): void => notImplemented());

export const expect = notImplementedApi(
  Object.assign((): never => notImplemented(), { notImplemented: true as const }),
);
