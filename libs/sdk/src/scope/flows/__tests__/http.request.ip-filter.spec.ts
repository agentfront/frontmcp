/**
 * `throttle.ipFilter` is enforced on the request path (GHSA-hwfp-xv2f-fr8g).
 *
 * `@frontmcp/guard` builds an `IpFilter` whenever `throttle.ipFilter` is configured and
 * exposes `GuardManager.checkIpFilter()`. The SDK never called it. The documented
 * allowList/denyList/defaultAction policy was accepted, initialised, unit-tested — and had
 * no effect on any request.
 *
 * The `acquireQuota` stage compounded it by returning early on `!manager?.config?.global`,
 * so a deployment configured with `ipFilter` alone performed no guard work whatsoever. The
 * failure was silent: the server started normally and sibling guard features such as rate
 * limiting kept working, so an operator had no signal that their network boundary was
 * inert.
 */
import HttpRequestFlow from '../http.request.flow';

type Responded = { status?: number; body?: unknown };

/**
 * Drive the real `acquireQuota` stage with a stubbed scope. The stage is the enforcement
 * point, so the test has to call it rather than re-implement its decision.
 */
function createStage(options: {
  ipFilterResult?: { allowed: boolean; reason?: string };
  global?: unknown;
  clientIp?: string;
  rateLimitAllowed?: boolean;
}) {
  const checkIpFilter = jest.fn(() => options.ipFilterResult);
  const checkGlobalRateLimit = jest.fn(async () => ({ allowed: options.rateLimitAllowed ?? true }));

  const responded: Responded[] = [];
  const stage = Object.create(HttpRequestFlow.prototype) as HttpRequestFlow & Record<string, unknown>;

  Object.assign(stage, {
    scope: {
      rateLimitManager: {
        config: options.global ? { global: options.global } : {},
        checkIpFilter,
        checkGlobalRateLimit,
      },
    },
    logger: { debug: jest.fn(), verbose: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() },
    requestId: 'req-1',
    tryGetContext: () => ({
      sessionId: 'session-1',
      metadata: { clientIp: options.clientIp ?? '127.0.0.1' },
      authInfo: undefined,
    }),
    respond: (value: unknown) => {
      responded.push(value as Responded);
    },
  });

  return { stage, checkIpFilter, checkGlobalRateLimit, responded };
}

describe('http:request acquireQuota — ipFilter enforcement (GHSA-hwfp-xv2f-fr8g)', () => {
  it('consults the IP filter even when no global rate limit is configured', async () => {
    const { stage, checkIpFilter } = createStage({ ipFilterResult: { allowed: true } });

    await (stage as any).acquireQuota();

    // The early return on a missing `global` block used to skip this entirely.
    expect(checkIpFilter).toHaveBeenCalledWith('127.0.0.1');
  });

  it('rejects a denied client IP with 403', async () => {
    const { stage, responded } = createStage({
      ipFilterResult: { allowed: false, reason: 'IP address "127.0.0.1" is blocked' },
    });

    await (stage as any).acquireQuota();

    expect(responded).toHaveLength(1);
    expect(responded[0].status).toBe(403);
  });

  it('does not run the rate-limit check for a rejected IP', async () => {
    const { stage, checkGlobalRateLimit } = createStage({
      ipFilterResult: { allowed: false, reason: 'blocked' },
      global: { maxRequests: 10, windowMs: 60_000 },
    });

    await (stage as any).acquireQuota();

    expect(checkGlobalRateLimit).not.toHaveBeenCalled();
  });

  it('lets an allowed IP through to the rate-limit check', async () => {
    const { stage, checkGlobalRateLimit, responded } = createStage({
      ipFilterResult: { allowed: true },
      global: { maxRequests: 10, windowMs: 60_000 },
    });

    await (stage as any).acquireQuota();

    expect(checkGlobalRateLimit).toHaveBeenCalled();
    expect(responded).toHaveLength(0);
  });

  it('still enforces the global rate limit', async () => {
    const { stage, responded } = createStage({
      ipFilterResult: { allowed: true },
      global: { maxRequests: 10, windowMs: 60_000 },
      rateLimitAllowed: false,
    });

    await (stage as any).acquireQuota();

    expect(responded).toHaveLength(1);
    expect(responded[0].status).toBe(429);
  });

  it('is a no-op when no filter is configured and no global limit is set', async () => {
    const { stage, checkGlobalRateLimit, responded } = createStage({ ipFilterResult: undefined });

    await (stage as any).acquireQuota();

    expect(checkGlobalRateLimit).not.toHaveBeenCalled();
    expect(responded).toHaveLength(0);
  });
});
