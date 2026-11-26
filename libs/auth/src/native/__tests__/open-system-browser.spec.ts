import { EventEmitter } from 'node:events';

import { openSystemBrowser } from '../native-sign-in';

const mockSpawn = jest.fn();
jest.mock('@frontmcp/utils', () => ({ ...jest.requireActual('@frontmcp/utils'), getSpawnFn: () => mockSpawn }));

function fakeChild(event: 'spawn' | 'error') {
  const child = Object.assign(new EventEmitter(), { unref: jest.fn() });
  setImmediate(() => (event === 'spawn' ? child.emit('spawn') : child.emit('error', new Error('ENOENT xdg-open'))));
  return child;
}

describe('openSystemBrowser', () => {
  const platform = process.platform;
  const url = 'https://auth.example.com/authorize?client_id=a&state=b';

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: platform });
    mockSpawn.mockReset();
  });

  it.each([
    ['darwin', 'open', [url]],
    ['win32', 'rundll32', ['url.dll,FileProtocolHandler', url]],
    ['linux', 'xdg-open', [url]],
  ])('on %s runs %s detached', async (os, command, args) => {
    Object.defineProperty(process, 'platform', { value: os });
    const child = fakeChild('spawn');
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
});
