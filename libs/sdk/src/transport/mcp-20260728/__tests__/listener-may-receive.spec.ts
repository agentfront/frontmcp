import { listenerMayReceive } from '../subscriptions';

describe('listenerMayReceive', () => {
  it('lets an update through when the read check passes and the credentials hold on both sides of it', async () => {
    expect(
      await listenerMayReceive(
        () => false,
        async () => true,
      ),
    ).toBe(true);
  });

  it('checks nothing once the credentials expired', async () => {
    const mayRead = jest.fn(async () => true);

    expect(await listenerMayReceive(() => true, mayRead)).toBe(false);
    expect(mayRead).not.toHaveBeenCalled();
  });

  it('holds back an update when the credentials expire while the read is checked', async () => {
    let expired = false;
    const mayRead = async () => {
      expired = true;
      return true;
    };

    expect(await listenerMayReceive(() => expired, mayRead)).toBe(false);
  });

  it('holds back an update the read check refuses', async () => {
    expect(
      await listenerMayReceive(
        () => false,
        async () => false,
      ),
    ).toBe(false);
  });
});
