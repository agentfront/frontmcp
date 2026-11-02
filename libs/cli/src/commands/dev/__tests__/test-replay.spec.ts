import { runReplay } from '../replay';
import { runTest } from '../test';

jest.mock('../replay', () => ({ runReplay: jest.fn(async () => undefined) }));

describe('runTest --replay', () => {
  it('replays the recording instead of running Jest', async () => {
    const opts = { _: ['test'], replay: 'calls.jsonl' };

    await runTest(opts);

    expect(runReplay).toHaveBeenCalledWith(opts);
  });
});
