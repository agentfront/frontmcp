import { McpStatelessError } from '../../../transport/mcp-20260728';
import { isTransientError, remoteHttpFailureOf, withRetry } from '../retry';

function httpError(status: number, retryAfterMs?: number): McpStatelessError {
  return new McpStatelessError(-32603, `HTTP ${status}: boom`, undefined, { status, retryAfterMs });
}

describe('isTransientError', () => {
  it.each([408, 425, 429, 500, 502, 503, 504])('retries HTTP %i', (status) => {
    expect(isTransientError(httpError(status))).toBe(true);
  });

  it.each([400, 401, 403, 404, 501, 505])('does not retry HTTP %i', (status) => {
    expect(isTransientError(httpError(status))).toBe(false);
  });

  it('reads the status of the error a remote error wraps, not the words of its message', () => {
    const wrapped = Object.assign(new Error('Remote tool "echo" on "up" failed: invoice 503 is closed'), {
      originalError: Object.assign(new Error('Streamable HTTP error: Error POSTing to endpoint: boom'), { code: 400 }),
    });
    expect(isTransientError(wrapped)).toBe(false);
    expect(isTransientError(new Error('Error POSTing to endpoint (HTTP 503): boom'))).toBe(true);
  });

  it('retries network failures and timeouts', () => {
    expect(isTransientError(new TypeError('fetch failed'))).toBe(true);
    expect(isTransientError(new Error('connect ECONNREFUSED 10.0.0.1:443'))).toBe(true);
    expect(isTransientError(new Error('tool failed'))).toBe(false);
  });
});

describe('withRetry', () => {
  it("waits the remote's Retry-After instead of the backoff, up to maxDelayMs", async () => {
    const delays: number[] = [];
    const operation = jest.fn().mockRejectedValueOnce(httpError(503, 20)).mockResolvedValue('ok');

    await expect(
      withRetry(operation, {
        initialDelayMs: 5000,
        maxDelayMs: 10_000,
        onRetry: (_attempt, _error, delayMs) => delays.push(delayMs),
      }),
    ).resolves.toBe('ok');
    expect(delays).toEqual([20]);
    expect(remoteHttpFailureOf(httpError(429, 999_999))).toEqual({ status: 429, retryAfterMs: 999_999 });
  });
});
