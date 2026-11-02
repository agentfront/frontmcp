import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PassThrough } from 'stream';

import { watchParent, watchPath } from '../process-watch';

function esrch(): Error {
  return Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
}

describe('watchParent', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reports the parent gone once this process is reparented', () => {
    let parent = 4000;
    const onGone = jest.fn();
    watchParent({ onGone, intervalMs: 100 }, { ppid: () => parent, kill: jest.fn() });

    jest.advanceTimersByTime(300);
    expect(onGone).not.toHaveBeenCalled();
    parent = 1;
    jest.advanceTimersByTime(100);

    expect(onGone).toHaveBeenCalledWith('parent-exited');
    jest.advanceTimersByTime(1000);
    expect(onGone).toHaveBeenCalledTimes(1);
  });

  it('reports the parent gone when its pid no longer runs (no reparenting, as on Windows)', () => {
    const onGone = jest.fn();
    let alive = true;
    const kill = jest.fn(() => {
      if (!alive) throw esrch();
    });
    watchParent({ onGone }, { ppid: () => 4100, kill });

    jest.advanceTimersByTime(1000);
    expect(onGone).not.toHaveBeenCalled();
    alive = false;
    jest.advanceTimersByTime(1000);

    expect(kill).toHaveBeenCalledWith(4100, 0);
    expect(onGone).toHaveBeenCalledWith('parent-exited');
  });

  it('treats a parent it may not signal as running', () => {
    const onGone = jest.fn();
    const kill = jest.fn(() => {
      throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
    });
    watchParent({ onGone, intervalMs: 10 }, { ppid: () => 4200, kill });

    jest.advanceTimersByTime(100);
    expect(onGone).not.toHaveBeenCalled();
  });

  it('reports stdin ending', () => {
    const stdin = new PassThrough();
    const onGone = jest.fn();
    watchParent({ onGone, stdin }, { ppid: () => 4300, kill: jest.fn() });

    stdin.emit('end');
    stdin.emit('close');

    expect(onGone).toHaveBeenCalledTimes(1);
    expect(onGone).toHaveBeenCalledWith('stdin-ended');
  });

  it('reports stdin closing without an end', () => {
    const stdin = new PassThrough();
    const onGone = jest.fn();
    watchParent({ onGone, stdin }, { ppid: () => 4400, kill: jest.fn() });

    stdin.emit('close');

    expect(onGone).toHaveBeenCalledWith('stdin-ended');
  });

  it('polls nothing when the parent is already init', () => {
    const kill = jest.fn();
    const onGone = jest.fn();
    watchParent({ onGone }, { ppid: () => 1, kill });

    jest.advanceTimersByTime(5000);
    expect(kill).not.toHaveBeenCalled();
    expect(onGone).not.toHaveBeenCalled();
  });

  it('stops watching once closed', () => {
    const stdin = new PassThrough();
    let parent = 4500;
    const onGone = jest.fn();
    const watcher = watchParent({ onGone, stdin }, { ppid: () => parent, kill: jest.fn() });

    watcher.close();
    parent = 1;
    jest.advanceTimersByTime(5000);
    stdin.emit('end');

    expect(onGone).not.toHaveBeenCalled();
    expect(stdin.listenerCount('end')).toBe(0);
    expect(stdin.listenerCount('close')).toBe(0);
  });

  it('watches the real parent by default without keeping the process alive', () => {
    const onGone = jest.fn();
    const watcher = watchParent({ onGone, intervalMs: 50 });
    jest.advanceTimersByTime(500);
    watcher.close();
    expect(onGone).not.toHaveBeenCalled();
  });
});

describe('watchPath', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'watch-path-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('reports a removed directory once', async () => {
    const onGone = jest.fn();
    const watcher = watchPath(directory, { onGone, intervalMs: 10 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onGone).not.toHaveBeenCalled();

    rmSync(directory, { recursive: true, force: true });
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(onGone).toHaveBeenCalledTimes(1);
    watcher.close();
  });

  it('stops watching once closed', async () => {
    const onGone = jest.fn();
    watchPath(directory, { onGone, intervalMs: 10 }).close();
    rmSync(directory, { recursive: true, force: true });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(onGone).not.toHaveBeenCalled();
  });
});
