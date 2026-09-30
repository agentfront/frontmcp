import { runDevBridge } from '../index';

const supervisorStop = jest.fn(async () => undefined);
const supervisorStart = jest.fn(async () => undefined);
const watcherStop = jest.fn();
let framerOptions: { onClose?: () => void } = {};

jest.mock('../log', () => ({
  createBridgeLogger: async () => ({
    path: undefined,
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    reloadEvent: jest.fn(),
    close: async () => undefined,
  }),
}));
jest.mock('../stdio-framer', () => ({
  createStdioFramer: (options: { onClose?: () => void }) => {
    framerOptions = options;
    return { start: jest.fn(), stop: jest.fn(), write: jest.fn(async () => undefined) };
  },
}));
jest.mock('../child-supervisor', () => ({
  createChildSupervisor: () => ({ start: supervisorStart, stop: supervisorStop, restart: jest.fn() }),
}));
jest.mock('../watcher', () => ({
  createDevWatcher: () => ({ start: jest.fn(), stop: watcherStop }),
}));
jest.mock('../state-machine', () => ({
  createBridgeStateMachine: () => ({
    enqueue: jest.fn(),
    relayUpstream: jest.fn(),
    onChildReady: jest.fn(),
    onChildExit: jest.fn(),
    onBootStart: jest.fn(),
    onReloadDeadline: jest.fn(),
    onWatcherEvent: jest.fn(),
    stop: async () => undefined,
  }),
}));
jest.mock('../../../../shared/fs', () => ({ resolveEntry: async () => '/proj/src/main.ts' }));

describe('runDevBridge lifecycle (dev --stdio must not return while the child is running)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    framerOptions = {};
  });

  it('stays pending until stdin closes, then stops the child and resolves', async () => {
    let settled = false;
    const run = runDevBridge({ _: [], stdio: true } as never).then(() => {
      settled = true;
    });

    await new Promise((r) => setTimeout(r, 25));
    expect(settled).toBe(false);
    expect(supervisorStop).not.toHaveBeenCalled();

    framerOptions.onClose?.();
    await run;

    expect(settled).toBe(true);
    expect(supervisorStop).toHaveBeenCalledTimes(1);
    expect(watcherStop).toHaveBeenCalledTimes(1);
  });

  it('shuts down after boot when stdin closed while the first child was still starting', async () => {
    let releaseBoot: () => void = () => undefined;
    supervisorStart.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          releaseBoot = () => resolve(undefined);
        }),
    );

    const run = runDevBridge({ _: [], stdio: true } as never);
    await new Promise((r) => setTimeout(r, 10));
    framerOptions.onClose?.();
    expect(supervisorStop).not.toHaveBeenCalled();

    releaseBoot();
    await run;

    expect(supervisorStop).toHaveBeenCalledTimes(1);
  });
});
