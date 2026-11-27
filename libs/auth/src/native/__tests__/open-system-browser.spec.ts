import { EventEmitter } from 'node:events';

import { openSystemBrowser } from '../native-sign-in';
import { NativeSignInError } from '../native-sign-in.error';

const mockSpawn = jest.fn();
jest.mock('@frontmcp/utils', () => ({ ...jest.requireActual('@frontmcp/utils'), getSpawnFn: () => mockSpawn }));

/** A launcher that starts (or fails to), then exits with `exitCode`, or keeps running when it is `undefined`. */
function fakeChild(start: 'spawn' | 'error', exitCode?: number) {
  const child = Object.assign(new EventEmitter(), { unref: jest.fn() });
  setImmediate(() => {
    if (start === 'error') {
      child.emit('error', new Error('ENOENT xdg-open'));
      return;
    }
    child.emit('spawn');
    if (exitCode !== undefined) setImmediate(() => child.emit('exit', exitCode, null));
  });
  return child;
}

describe('openSystemBrowser', () => {
  const platform = process.platform;
  const url = 'https://auth.example.com/authorize?client_id=a&state=b';

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: platform });
    mockSpawn.mockReset();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it.each([
    ['darwin', 'open', [url]],
    ['win32', 'rundll32', ['url.dll,FileProtocolHandler', url]],
    ['linux', 'xdg-open', [url]],
  ])('on %s runs %s detached, and resolves when it exits with status 0', async (os, command, args) => {
    Object.defineProperty(process, 'platform', { value: os });
    const child = fakeChild('spawn', 0);
    mockSpawn.mockReturnValue(child);

    await openSystemBrowser(url);

    expect(mockSpawn).toHaveBeenCalledWith(command, args, { detached: true, stdio: 'ignore' });
    expect(child.unref).toHaveBeenCalled();
  });

  it('rejects when the opener cannot start', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    mockSpawn.mockReturnValue(fakeChild('error'));

    await expect(openSystemBrowser(url)).rejects.toThrow('ENOENT xdg-open');
  });

  it('rejects when the opener starts and then exits with another status, such as xdg-open with no browser', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    mockSpawn.mockReturnValue(fakeChild('spawn', 3));

    const error = await openSystemBrowser(url).then(
      () => undefined,
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(NativeSignInError);
    expect(error).toMatchObject({ code: 'browser_launch_failed', message: expect.stringContaining('status 3') });
  });

  it('keeps the process running until it settles, for a caller with nothing else to wait on', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const child = fakeChild('spawn');
    mockSpawn.mockReturnValue(child);
    const timers: ReturnType<typeof setTimeout>[] = [];
    const realSetTimeout = setTimeout;
    jest.spyOn(global, 'setTimeout').mockImplementation(((...args: Parameters<typeof setTimeout>) => {
      const timer = realSetTimeout(...args);
      timers.push(timer);
      return timer;
    }) as typeof setTimeout);

    const opening = openSystemBrowser(url);
    await new Promise((resolve) => setImmediate(resolve));
    const referenced = timers.map((timer) => timer.hasRef());
    child.emit('exit', 0, null);
    await opening;

    expect(referenced).toEqual([true]);
  });

  it('resolves for an opener still running after 2 seconds, as one that runs the browser itself is', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    Object.defineProperty(process, 'platform', { value: 'linux' });
    mockSpawn.mockReturnValue(fakeChild('spawn'));
    let opened = false;

    const opening = openSystemBrowser(url).then(() => (opened = true));
    await new Promise((resolve) => setImmediate(resolve));
    jest.advanceTimersByTime(1_999);
    await Promise.resolve();
    expect(opened).toBe(false);
    jest.advanceTimersByTime(1);
    await opening;

    expect(opened).toBe(true);
  });
});
