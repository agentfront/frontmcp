import { HealthChecker } from '../health-check';

describe('HealthChecker first check (#646)', () => {
  it('reports healthy after the first successful check instead of waiting for a second interval', async () => {
    const checker = new HealthChecker('remote', async () => undefined, { intervalMs: 60_000 });
    const result = await checker.check();
    expect(result.status).toBe('healthy');
  });

  it('keeps hysteresis once known: one failure does not flip a healthy checker', async () => {
    let fail = false;
    const checker = new HealthChecker(
      'remote',
      async () => {
        if (fail) throw new Error('down');
      },
      { intervalMs: 60_000, unhealthyThreshold: 3 },
    );
    await checker.check();
    fail = true;
    const result = await checker.check();
    expect(result.status).toBe('healthy');
  });
});
