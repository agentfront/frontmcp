import { superviseUntilSignalled } from '../keep-alive';
import type { ProcessManager } from '../manager';

describe('superviseUntilSignalled (#642)', () => {
  it('stays pending until SIGTERM, then stops the managed process', async () => {
    const pm = { stop: jest.fn().mockResolvedValue(undefined) } as unknown as ProcessManager;
    let done = false;
    const promise = superviseUntilSignalled(pm, 'svc').then(() => {
      done = true;
    });

    await new Promise((r) => setImmediate(r));
    expect(done).toBe(false);

    process.emit('SIGTERM');
    await promise;

    expect(pm.stop).toHaveBeenCalledWith('svc');
  });
});
