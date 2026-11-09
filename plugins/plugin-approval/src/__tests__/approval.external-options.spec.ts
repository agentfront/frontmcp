/** The webhook and recheck options `ApprovalPlugin.init()` refuses, so a server that can't use them doesn't start. */
import 'reflect-metadata';

import { ApprovalConfigurationError } from '../approval';
import { resolveExternalApproval } from '../approval.options';
import ApprovalPlugin, { type ApprovalPluginOptions } from '../approval.plugin';

const SECRET = 'a-webhook-secret-of-at-least-32-chars';
const webhook = (options: NonNullable<ApprovalPluginOptions['webhook']>): ApprovalPluginOptions => ({
  mode: 'webhook',
  webhook: { url: 'https://approvals.example.com/hook', secret: SECRET, ...options },
});

function refusal(options: ApprovalPluginOptions): string {
  try {
    resolveExternalApproval(options);
  } catch (error) {
    expect(error).toBeInstanceOf(ApprovalConfigurationError);
    return (error as Error).message;
  }
  throw new Error('expected the options to be refused');
}

describe('ApprovalPlugin webhook and recheck options', () => {
  const originalNodeEnv = process.env['NODE_ENV'];
  afterEach(() => {
    process.env['NODE_ENV'] = originalNodeEnv;
  });

  it('configures nothing external without a webhook or recheck URL', () => {
    expect(resolveExternalApproval({})).toEqual({ webhook: undefined, recheck: undefined });
    expect(resolveExternalApproval({ mode: 'webhook', webhook: { challengeTtl: 60 } })).toEqual({
      webhook: undefined,
      recheck: undefined,
    });
  });

  it('resolves a webhook with its defaults', () => {
    expect(resolveExternalApproval(webhook({})).webhook).toEqual({
      url: 'https://approvals.example.com/hook',
      signingKey: new TextEncoder().encode(SECRET),
      includeJwt: false,
      callbackPath: '/approval/callback',
      challengeTtlSeconds: 300,
    });
  });

  it('reads a Standard Webhooks secret as base64', () => {
    const key = new Uint8Array(32).fill(7);
    const resolved = resolveExternalApproval(webhook({ secret: `whsec_${Buffer.from(key).toString('base64')}` }));
    expect(resolved.webhook?.signingKey).toEqual(key);
  });

  it.each<[string, ApprovalPluginOptions, string]>([
    ['a webhook outside webhook mode', { webhook: { url: 'https://a.example.com' } }, "need `mode: 'webhook'`"],
    ['webhook options without a URL', { mode: 'webhook', webhook: { includeJwt: true } }, 'need `webhook.url`'],
    ['a webhook without a secret', webhook({ secret: undefined }), 'needs `webhook.secret`'],
    ['a blank secret', webhook({ secret: '   ' }), 'needs `webhook.secret`'],
    ['a short secret', webhook({ secret: 'short' }), 'must be at least 24 bytes'],
    ['a whsec_ secret that is not base64', webhook({ secret: 'whsec_not base64!' }), 'is not base64'],
    ['a short whsec_ secret', webhook({ secret: 'whsec_AAAA' }), 'must be at least 24 bytes'],
    ['a webhook URL that does not parse', webhook({ url: 'not a url' }), '`webhook.url` is not a URL'],
    ['an http webhook URL', webhook({ url: 'http://approvals.example.com/hook' }), 'must be an https:// URL'],
    [
      'a webhook URL with credentials',
      webhook({ url: 'https://u:p@approvals.example.com' }),
      'must not carry credentials',
    ],
    ['a relative callback path', webhook({ callbackPath: 'approval' }), 'must be a path'],
    ['a callback path with a query', webhook({ callbackPath: '/approval?x=1' }), 'must be a path'],
    [
      'a recheck in webhook mode',
      { mode: 'webhook', recheck: { url: 'https://a.example.com' } },
      "needs `mode: 'recheck'`",
    ],
    ['recheck options without a URL', { recheck: { interval: 500 } }, '`recheck.interval` need `recheck.url`'],
    ['an empty recheck', { recheck: {} }, '`recheck` need `recheck.url`'],
    [
      'an unknown auth',
      { recheck: { url: 'https://a.example.com', auth: 'basic' as never } },
      '`recheck.auth` must be',
    ],
    [
      'bearer auth without a token',
      { recheck: { url: 'https://a.example.com', auth: 'bearer' } },
      'needs `recheck.token`',
    ],
    ['a token without bearer auth', { recheck: { url: 'https://a.example.com', token: 't' } }, 'only sent with'],
    [
      'custom auth without headers',
      { recheck: { url: 'https://a.example.com', auth: 'custom' } },
      'needs a `recheck.headers`',
    ],
    [
      'headers without custom auth',
      { recheck: { url: 'https://a.example.com', headers: () => ({}) } },
      'only used with',
    ],
    [
      'a fractional interval',
      { recheck: { url: 'https://a.example.com', interval: 1.5 } },
      '`recheck.interval` must be',
    ],
    ['a tiny interval', { recheck: { url: 'https://a.example.com', interval: 10 } }, 'from 100 to 60000'],
    ['zero attempts', { recheck: { url: 'https://a.example.com', maxAttempts: 0 } }, '`recheck.maxAttempts` must be'],
    [
      'a wait over two minutes',
      { recheck: { url: 'https://a.example.com', interval: 60_000, maxAttempts: 4 } },
      'would keep a call waiting 180000 ms',
    ],
    ['an http recheck URL', { recheck: { url: 'http://approvals.example.com' } }, '`recheck.url` must be an https://'],
    [
      'a short recheck secret',
      { recheck: { url: 'https://a.example.com', secret: 'short' } },
      '`recheck.secret` must be',
    ],
  ])('refuses %s', (_, options, message) => {
    expect(refusal(options)).toContain(message);
  });

  it('names only the scheme and host of a refused URL', () => {
    const message = refusal(webhook({ url: 'http://approvals.example.com/hook?token=abc' }));
    expect(message).toContain('got http://approvals.example.com');
    expect(message).not.toContain('token=abc');
  });

  it('accepts http://localhost outside production, and refuses it in production', () => {
    process.env['NODE_ENV'] = 'development';
    expect(resolveExternalApproval(webhook({ url: 'http://localhost:4000/hook' })).webhook?.url).toBe(
      'http://localhost:4000/hook',
    );
    expect(resolveExternalApproval({ recheck: { url: 'http://127.0.0.1:4000/status' } }).recheck?.url).toBe(
      'http://127.0.0.1:4000/status',
    );

    process.env['NODE_ENV'] = 'production';
    expect(refusal(webhook({ url: 'http://localhost:4000/hook' }))).toContain('must be an https:// URL');
  });

  it('resolves a recheck with its defaults', () => {
    expect(resolveExternalApproval({ recheck: { url: 'https://approvals.example.com/status' } }).recheck).toEqual({
      url: 'https://approvals.example.com/status',
      auth: 'none',
      token: undefined,
      headers: undefined,
      signingKey: undefined,
      intervalMs: 2000,
      maxAttempts: 5,
    });
  });

  it('refuses the options from init(), before the server starts', () => {
    expect(() => ApprovalPlugin.init({ mode: 'webhook', webhook: { url: 'https://a.example.com/hook' } })).toThrow(
      ApprovalConfigurationError,
    );
  });
});
