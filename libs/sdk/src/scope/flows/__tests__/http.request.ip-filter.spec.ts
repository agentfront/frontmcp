/**
 * `throttle.ipFilter` is enforced on the request path (GHSA-hwfp-xv2f-fr8g).
 *
 * `@frontmcp/guard` builds an `IpFilter` whenever `throttle.ipFilter` is configured and
 * exposes `GuardManager.checkIpFilter()`. The SDK never called it. The documented
 * allowList/denyList/defaultAction policy was accepted, initialised, unit-tested — and had
 * no effect on any request.
 *
 * The filter now runs in its own `checkIpFilter` stage, ahead of `acquireQuota` and of
 * authentication, so it does not depend on a global rate limit being configured.
 */
import 'reflect-metadata';

import { GuardStorageUnavailableError } from '@frontmcp/guard';

import { FlowControl, FrontMcpFlowTokens } from '../../../common';
import HttpRequestFlow from '../http.request.flow';

type Responded = { status?: number; body?: unknown };

/** Drive the real stages with a stubbed scope, so the test exercises their decision rather than restating it. */
function createStage(options: {
  ipFilterResult?: { allowed: boolean; reason?: string };
  global?: unknown;
  clientIp?: string;
  rateLimitAllowed?: boolean;
  rateLimitError?: Error;
}) {
  const checkIpFilter = jest.fn(() => options.ipFilterResult);
  const checkGlobalRateLimit = jest.fn(async () => {
    if (options.rateLimitError) throw options.rateLimitError;
    return { allowed: options.rateLimitAllowed ?? true };
  });

  const responded: Responded[] = [];
  const stage = Object.create(HttpRequestFlow.prototype) as HttpRequestFlow & Record<string, unknown>;

  Object.assign(stage, {
    scope: {
      rateLimitManager: {
        config: options.global ? { global: options.global } : {},
        checkIpFilter,
        checkGlobalRateLimit,
      },
      logger: { warn: jest.fn() },
    },
    logger: { debug: jest.fn(), verbose: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() },
    requestId: 'req-1',
    rawInput: { request: { body: { jsonrpc: '2.0', id: 7, method: 'tools/call' } } },
    tryGetContext: () => ({
      sessionId: 'session-1',
      metadata: { clientIp: options.clientIp ?? '127.0.0.1' },
      authInfo: undefined,
      set: jest.fn(),
    }),
    respond: (value: unknown) => {
      responded.push(value as Responded);
    },
  });

  return { stage, checkIpFilter, checkGlobalRateLimit, responded };
}

async function runStage(run: () => Promise<void>, responded: Responded[]): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (!(error instanceof FlowControl) || error.type !== 'respond') throw error;
    responded.push(error.output as Responded);
  }
}

describe('http:request checkIpFilter — ipFilter enforcement (GHSA-hwfp-xv2f-fr8g)', () => {
  it('consults the IP filter even when no global rate limit is configured', async () => {
    const { stage, checkIpFilter, responded } = createStage({ ipFilterResult: { allowed: true } });

    await runStage(() => (stage as any).checkIpFilter(), responded);

    expect(checkIpFilter).toHaveBeenCalledWith('127.0.0.1');
    expect(responded).toHaveLength(0);
  });

  it('rejects a denied client IP with 403', async () => {
    const { stage, responded } = createStage({
      ipFilterResult: { allowed: false, reason: 'denylisted' },
    });

    await runStage(() => (stage as any).checkIpFilter(), responded);

    expect(responded).toHaveLength(1);
    expect(responded[0].status).toBe(403);
    expect(responded[0].body).toMatchObject({ jsonrpc: '2.0', id: 7, error: { code: -32001 } });
  });

  it('runs before the rate-limit and authorization stages', () => {
    const plan = Reflect.getMetadata(FrontMcpFlowTokens.plan, HttpRequestFlow) as { pre: string[] };

    expect(plan.pre.slice(0, 4)).toEqual(['traceRequest', 'checkIpFilter', 'acquireQuota', 'acquireSemaphore']);
    expect(plan.pre.indexOf('checkIpFilter')).toBeLessThan(plan.pre.indexOf('checkAuthorization'));
  });

  it('lets the rate-limit stage enforce the global limit', async () => {
    const { stage, responded } = createStage({
      ipFilterResult: { allowed: true },
      global: { maxRequests: 10, windowMs: 60_000 },
      rateLimitAllowed: false,
    });

    await runStage(() => (stage as any).acquireQuota(), responded);

    expect(responded).toHaveLength(1);
    expect(responded[0].status).toBe(429);
    expect(responded[0].body).toMatchObject({ jsonrpc: '2.0', id: 7 });
  });

  it('answers a public 503 when the limit store is down mid-run (#680)', async () => {
    const { stage, responded } = createStage({
      ipFilterResult: { allowed: true },
      global: { maxRequests: 10, windowMs: 60_000 },
      rateLimitError: new GuardStorageUnavailableError('redis', new Error('connect ECONNREFUSED'), 'runtime'),
    });

    await runStage(() => (stage as any).acquireQuota(), responded);

    expect(responded).toHaveLength(1);
    expect(responded[0]).toMatchObject({
      status: 503,
      headers: { 'Retry-After': '1' },
      body: { jsonrpc: '2.0', id: 7, error: { code: -32603, data: { code: 'GUARD_STORAGE_UNAVAILABLE' } } },
    });
    // The store's own address stays in the server log, not in the response.
    expect(JSON.stringify(responded[0].body)).not.toContain('ECONNREFUSED');
  });

  it('lets any other rate-limit failure propagate', async () => {
    const { stage, responded } = createStage({
      global: { maxRequests: 10, windowMs: 60_000 },
      rateLimitError: new Error('boom'),
    });

    await expect(runStage(() => (stage as any).acquireQuota(), responded)).rejects.toThrow('boom');
  });

  it('is a no-op when no filter is configured and no global limit is set', async () => {
    const { stage, checkGlobalRateLimit, responded } = createStage({ ipFilterResult: undefined });

    await runStage(() => (stage as any).checkIpFilter(), responded);
    await runStage(() => (stage as any).acquireQuota(), responded);

    expect(checkGlobalRateLimit).not.toHaveBeenCalled();
    expect(responded).toHaveLength(0);
  });
});
