import type { ChildProcess } from 'node:child_process';

import type { ChildReadyInfo } from '../child-supervisor';
import { runDevBridge } from '../index';
import type { JsonRpcFrame } from '../stdio-framer';
import type { UpstreamClient } from '../upstream-client';

const supervisorStop = jest.fn(async () => undefined);
const supervisorStart = jest.fn(async () => undefined);
const watcherStop = jest.fn();
const framerWrite = jest.fn(async (_frame: JsonRpcFrame) => undefined);
const fsmOnChildReady = jest.fn();
let framerOptions: { onClose?: () => void } = {};
let supervisorOptions: { onReady?: (child: ChildProcess, info: ChildReadyInfo) => Promise<void> } = {};
let fsmOptions: { forward?: (frame: JsonRpcFrame) => Promise<void> } = {};
/** Upstreams handed out by `createHttpUpstream`, in order. */
const upstreams: UpstreamClient[] = [];

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
    return { start: jest.fn(), stop: jest.fn(), write: framerWrite };
  },
}));
jest.mock('../upstream-client', () => ({
  createHttpUpstream: () => {
    const next = upstreams.shift();
    if (!next) throw new Error('no upstream prepared for this test');
    return next;
  },
  createPipeUpstream: () => {
    throw new Error('pipe mode is not used here');
  },
}));
jest.mock('../child-supervisor', () => ({
  createChildSupervisor: (options: typeof supervisorOptions) => {
    supervisorOptions = options;
    return { start: supervisorStart, stop: supervisorStop, restart: jest.fn() };
  },
  resolveChildCommand: () => ({ command: process.execPath, args: [] }),
  resolveProjectTsxLoader: () => undefined,
}));
jest.mock('../watcher', () => ({
  createDevWatcher: () => ({ start: jest.fn(), stop: watcherStop }),
}));
jest.mock('../state-machine', () => ({
  createBridgeStateMachine: (options: typeof fsmOptions) => {
    fsmOptions = options;
    return {
      enqueue: jest.fn(),
      relayUpstream: jest.fn(),
      onChildReady: fsmOnChildReady,
      onChildExit: jest.fn(),
      onBootStart: jest.fn(),
      onReloadDeadline: jest.fn(),
      onWatcherEvent: jest.fn(),
      stop: async () => undefined,
    };
  },
}));
jest.mock('../../dev', () => ({
  resolveDevLaunch: async () => ({
    cwd: '/proj',
    entry: '/proj/src/main.ts',
    port: 3000,
    childEnv: {},
    resolved: { effectiveEnv: {} },
  }),
}));

describe('runDevBridge lifecycle (dev --stdio must not return while the child is running)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    framerOptions = {};
    supervisorOptions = {};
    fsmOptions = {};
    upstreams.length = 0;
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

  describe('a restarted child', () => {
    const child = {} as ChildProcess;
    const initialize: JsonRpcFrame = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };

    function fakeUpstream(reinitialize: UpstreamClient['reinitialize']): UpstreamClient & { close: jest.Mock } {
      return { send: jest.fn(async () => undefined), reinitialize, close: jest.fn(async () => undefined) };
    }

    /** Boot the bridge, attach the first child and let the client initialize through it. */
    async function bootWithInitializedClient(): Promise<{
      run: Promise<void>;
      onReady: NonNullable<typeof supervisorOptions.onReady>;
    }> {
      const run = runDevBridge({ _: [], stdio: true } as never);
      await new Promise((r) => setTimeout(r, 10));
      const { onReady } = supervisorOptions;
      const { forward } = fsmOptions;
      if (!onReady || !forward) throw new Error('bridge did not wire the supervisor and the FSM');
      await onReady(child, {});
      await forward(initialize);
      await forward({ jsonrpc: '2.0', method: 'notifications/initialized' });
      expect(fsmOnChildReady).toHaveBeenCalledTimes(1);
      return { run, onReady };
    }

    async function stop(run: Promise<void>): Promise<void> {
      framerOptions.onClose?.();
      await run;
    }

    it('gets the client handshake replayed, announces list changes, then drains', async () => {
      const reinitialize = jest.fn(async () => ({ capabilities: { tools: { listChanged: true } } }));
      upstreams.push(fakeUpstream(jest.fn()), fakeUpstream(reinitialize));
      const { run, onReady } = await bootWithInitializedClient();

      await onReady(child, {});

      expect(reinitialize).toHaveBeenCalledWith(initialize, true);
      expect(framerWrite).toHaveBeenCalledWith({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
      expect(fsmOnChildReady).toHaveBeenCalledTimes(2);
      await stop(run);
    });

    it('fails the launch, without draining into it, when the replayed handshake fails', async () => {
      const failing = fakeUpstream(async () => {
        throw new Error('replayed initialize failed: boom');
      });
      upstreams.push(fakeUpstream(jest.fn()), failing);
      const { run, onReady } = await bootWithInitializedClient();

      // The supervisor stops a child whose onReady rejects; the FSM stays in
      // its reload path instead of draining buffered requests into a child
      // that has no session for them.
      await expect(onReady(child, {})).rejects.toThrow('replayed initialize failed: boom');
      expect(fsmOnChildReady).toHaveBeenCalledTimes(1);
      expect(failing.close).toHaveBeenCalled();
      await stop(run);
    });
  });
});
