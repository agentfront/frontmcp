import 'reflect-metadata';

import {
  SaasJwksUnavailableError,
  SaasPushRefusedError,
  type BundlePushReceiver,
  type BundleTokenFailure,
} from '@frontmcp/adapters/skills';
import { FlowControl, httpInputSchema, HttpJsonSchema, type FlowMetadata, type ScopeEntry } from '@frontmcp/sdk';

import BundlePushFlow, { BUNDLE_PUSH_PATH } from '../push/bundle-push.flow';
import { BundleSyncService } from '../sync/bundle-sync.service';

const metadata = {
  name: 'skilled-openapi:bundle-push',
  plan: { pre: ['verifyPushToken'], execute: [] },
  inputSchema: httpInputSchema,
  outputSchema: HttpJsonSchema,
  access: 'public',
  middleware: { method: 'POST', path: BUNDLE_PUSH_PATH },
} as unknown as FlowMetadata<'skilled-openapi:bundle-push'>;

const log = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };
const scope = { logger: { child: () => log } } as unknown as ScopeEntry;

/** What the token check answers a push whose receiver refuses its token with `error`, and the lines it logs. */
async function pushAnswer(error: Error) {
  log.warn.mockClear();
  log.error.mockClear();
  const receiver: BundlePushReceiver = { verifyPushToken: jest.fn(async () => Promise.reject(error)) };
  const request = { method: 'POST', path: BUNDLE_PUSH_PATH, headers: { authorization: 'Bearer push-token' }, body: {} };
  const deps = new Map<unknown, unknown>([[BundleSyncService, { pushReceiver: receiver }]]);
  const flow = new BundlePushFlow(metadata, { request, response: {} }, scope, jest.fn(), deps as never);
  const outcome = (await flow.verifyPushToken().catch((thrown: unknown) => thrown)) as FlowControl;
  const logged = [...log.warn.mock.calls, ...log.error.mock.calls].flat().join('\n');
  return { response: outcome.output as { status: number; body: unknown; headers?: Record<string, string> }, logged };
}

describe('BundlePushFlow', () => {
  it('passes the request on when the bundle source takes no pushes', async () => {
    const request = { method: 'POST', path: BUNDLE_PUSH_PATH, headers: { authorization: 'Bearer token' }, body: {} };
    const deps = new Map<unknown, unknown>([[BundleSyncService, { pushReceiver: undefined }]]);
    const flow = new BundlePushFlow(metadata, { request, response: {} }, scope, jest.fn(), deps as never);

    const outcome = await flow.verifyPushToken().catch((thrown: unknown) => thrown);

    expect(outcome).toBeInstanceOf(FlowControl);
    expect((outcome as FlowControl).type).toBe('next');
  });

  it.each([
    ['the exact bytes of the body', new TextEncoder().encode('{ "version": "2.0.0" }\n'), '{ "version": "2.0.0" }\n'],
    ['an empty body when the request carried none', undefined, ''],
  ])('hands the token check %s', async (_label, bodyBytes, expectedText) => {
    const verifyPushToken = jest.fn(async () => undefined);
    const request = {
      method: 'POST',
      path: BUNDLE_PUSH_PATH,
      headers: { authorization: 'Bearer push-token' },
      body: { version: '2.0.0' },
      bodyBytes,
    };
    const deps = new Map<unknown, unknown>([[BundleSyncService, { pushReceiver: { verifyPushToken } }]]);
    const flow = new BundlePushFlow(metadata, { request, response: {} }, scope, jest.fn(), deps as never);

    await flow.verifyPushToken();

    const [[token, body]] = verifyPushToken.mock.calls as unknown as Array<[string, Uint8Array]>;
    expect(token).toBe('push-token');
    expect(new TextDecoder().decode(body)).toBe(expectedText);
  });

  it.each<BundleTokenFailure>([
    'expired',
    'wrong_issuer',
    'wrong_audience',
    'unknown_key',
    'bad_signature',
    'malformed',
    'body_mismatch',
  ])('answers a token refused as %s with the same generic 401, and logs the check', async (tokenFailure) => {
    const { response, logged } = await pushAnswer(
      new SaasPushRefusedError('invalid-token', 'not a valid token from issuer', tokenFailure),
    );

    expect(response).toMatchObject({
      status: 401,
      body: { error: 'invalid_token', error_description: 'the push token was refused' },
    });
    expect(JSON.stringify(response)).not.toContain(tokenFailure);
    expect(logged).toContain(`[saas-source] push refused (${tokenFailure}): not a valid token from issuer`);
  });

  it("answers 503 temporarily_unavailable when the issuer's JWKS can't be read, and logs jwks_unavailable", async () => {
    const { response, logged } = await pushAnswer(
      new SaasJwksUnavailableError('JWKS https://x.example/jwks responded 503'),
    );

    expect(response).toMatchObject({
      status: 503,
      body: { error: 'temporarily_unavailable', error_description: "the issuer's JWKS could not be read" },
    });
    expect(logged).toBe('bundle push not checked (jwks_unavailable): JWKS https://x.example/jwks responded 503');
  });

  it('logs an unexpected failure of the check without naming a token check', async () => {
    const { response, logged } = await pushAnswer(new Error('boom'));

    expect(response).toMatchObject({ status: 503 });
    expect(logged).toBe('bundle push not checked: boom');
  });
});
