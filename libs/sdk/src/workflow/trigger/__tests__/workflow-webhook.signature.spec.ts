import {
  signWorkflowWebhook,
  verifyWorkflowWebhook,
  WORKFLOW_WEBHOOK_TOLERANCE_SECONDS,
  WorkflowWebhookReplayGuard,
} from '../workflow-webhook.signature';

const SECRET = 'test-webhook-secret-0123456789abcdef';
const NOW = 1_700_000_000;
const encoder = new TextEncoder();

function signed(body: string, options: { secret?: string; timestamp?: number } = {}) {
  const timestamp = String(options.timestamp ?? NOW);
  const bytes = encoder.encode(body);
  return {
    headers: {
      'x-frontmcp-timestamp': timestamp,
      'x-frontmcp-signature': signWorkflowWebhook(options.secret ?? SECRET, timestamp, bytes),
    },
    body: bytes,
  };
}

describe('signWorkflowWebhook', () => {
  it('is v1= and the hex HMAC-SHA256 of "<timestamp>.<body>"', () => {
    // openssl: printf '1700000000.{"ref":"main"}' | openssl dgst -sha256 -hmac test-webhook-secret-0123456789abcdef
    expect(signWorkflowWebhook(SECRET, '1700000000', encoder.encode('{"ref":"main"}'))).toBe(
      'v1=820bfffa0c920faf3cad16779c308076f847b30c404ecdd92255dd6b44f132d0',
    );
  });
});

describe('verifyWorkflowWebhook', () => {
  it('accepts a request signed with the secret, within the tolerance', () => {
    expect(verifyWorkflowWebhook(signed('{"ref":"main"}'), SECRET, new WorkflowWebhookReplayGuard(), NOW)).toBe(
      undefined,
    );
  });

  it('accepts the hex in upper case, and an array header', () => {
    const request = signed('{}');
    const headers = {
      'x-frontmcp-timestamp': [request.headers['x-frontmcp-timestamp']],
      'x-frontmcp-signature': `v1=${request.headers['x-frontmcp-signature'].slice(3).toUpperCase()}`,
    };

    expect(verifyWorkflowWebhook({ ...request, headers }, SECRET, new WorkflowWebhookReplayGuard(), NOW)).toBe(
      undefined,
    );
  });

  it('refuses a request without either header as unsigned', () => {
    const { headers, body } = signed('{}');
    const guard = new WorkflowWebhookReplayGuard();

    expect(verifyWorkflowWebhook({ headers: {}, body }, SECRET, guard, NOW)).toBe('unsigned');
    expect(
      verifyWorkflowWebhook(
        { headers: { 'x-frontmcp-signature': headers['x-frontmcp-signature'] }, body },
        SECRET,
        guard,
        NOW,
      ),
    ).toBe('unsigned');
    expect(
      verifyWorkflowWebhook(
        { headers: { 'x-frontmcp-timestamp': headers['x-frontmcp-timestamp'] }, body },
        SECRET,
        guard,
        NOW,
      ),
    ).toBe('unsigned');
  });

  it.each([
    ['a signature without its version', (hex: string) => ({ 'x-frontmcp-signature': hex.slice(3) })],
    ['a signature of another version', (hex: string) => ({ 'x-frontmcp-signature': `v2=${hex.slice(3)}` })],
    ['a short signature', (hex: string) => ({ 'x-frontmcp-signature': hex.slice(0, -2) })],
    ['a timestamp that is not a number', () => ({ 'x-frontmcp-timestamp': 'soon' })],
    ['a timestamp in milliseconds past 12 digits', () => ({ 'x-frontmcp-timestamp': '1700000000000' })],
  ])('refuses %s as malformed', (_label, override) => {
    const request = signed('{}');
    const headers = { ...request.headers, ...override(request.headers['x-frontmcp-signature']) };

    expect(verifyWorkflowWebhook({ ...request, headers }, SECRET, new WorkflowWebhookReplayGuard(), NOW)).toBe(
      'malformed',
    );
  });

  it('refuses a timestamp outside the tolerance, either way, as expired', () => {
    const guard = new WorkflowWebhookReplayGuard();
    const late = signed('{}', { timestamp: NOW - WORKFLOW_WEBHOOK_TOLERANCE_SECONDS - 1 });
    const early = signed('{}', { timestamp: NOW + WORKFLOW_WEBHOOK_TOLERANCE_SECONDS + 1 });
    const edge = signed('{}', { timestamp: NOW - WORKFLOW_WEBHOOK_TOLERANCE_SECONDS });

    expect(verifyWorkflowWebhook(late, SECRET, guard, NOW)).toBe('expired');
    expect(verifyWorkflowWebhook(early, SECRET, guard, NOW)).toBe('expired');
    expect(verifyWorkflowWebhook(edge, SECRET, guard, NOW)).toBe(undefined);
  });

  it('refuses another secret, a changed body and a changed timestamp as a bad signature', () => {
    const guard = new WorkflowWebhookReplayGuard();
    const request = signed('{"ref":"main"}');

    expect(verifyWorkflowWebhook(signed('{}', { secret: `${SECRET}-other` }), SECRET, guard, NOW)).toBe(
      'bad signature',
    );
    expect(verifyWorkflowWebhook({ ...request, body: encoder.encode('{"ref":"prod"}') }, SECRET, guard, NOW)).toBe(
      'bad signature',
    );
    expect(
      verifyWorkflowWebhook(
        { ...request, headers: { ...request.headers, 'x-frontmcp-timestamp': String(NOW + 1) } },
        SECRET,
        guard,
        NOW,
      ),
    ).toBe('bad signature');
  });

  it('refuses a request accepted before as replayed, until its timestamp leaves the tolerance', () => {
    const guard = new WorkflowWebhookReplayGuard();
    const request = signed('{"ref":"main"}');

    expect(verifyWorkflowWebhook(request, SECRET, guard, NOW)).toBe(undefined);
    expect(verifyWorkflowWebhook(request, SECRET, guard, NOW + 10)).toBe('replayed');
    expect(verifyWorkflowWebhook(signed('{"ref":"other"}'), SECRET, guard, NOW + 10)).toBe(undefined);
    expect(verifyWorkflowWebhook(request, SECRET, guard, NOW + WORKFLOW_WEBHOOK_TOLERANCE_SECONDS + 1)).toBe('expired');
  });
});

describe('WorkflowWebhookReplayGuard', () => {
  it('forgets a signature once its timestamp leaves the tolerance', () => {
    const guard = new WorkflowWebhookReplayGuard();

    expect(guard.claim('a', NOW, NOW)).toBeUndefined();
    expect(guard.claim('a', NOW, NOW + WORKFLOW_WEBHOOK_TOLERANCE_SECONDS)).toBe('replayed');
    expect(guard.claim('a', NOW, NOW + WORKFLOW_WEBHOOK_TOLERANCE_SECONDS + 1)).toBeUndefined();
  });

  it('remembers at most 10000 signatures, refusing new ones rather than forgetting one before it expires', () => {
    const guard = new WorkflowWebhookReplayGuard();
    for (let index = 0; index < 10_000; index++) guard.claim(`signature-${index}`, NOW, NOW);

    expect(guard.claim('signature-10000', NOW, NOW)).toBe('too many');
    expect(guard.claim('signature-0', NOW, NOW)).toBe('replayed');
    expect(guard.claim('signature-10000', NOW, NOW + WORKFLOW_WEBHOOK_TOLERANCE_SECONDS + 1)).toBeUndefined();
  });
});
