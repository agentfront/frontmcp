import 'reflect-metadata';

import { Worker, workerMetadataOf, type WorkerMetadata, type WorkerRunContext } from '../../common';
import { InvalidDecoratorMetadataError } from '../../errors';

function decorate(metadata: WorkerMetadata): object {
  @Worker(metadata)
  class InboxWatcher {
    run(_context: WorkerRunContext): void {
      return undefined;
    }
  }
  return new InboxWatcher();
}

function decorationError(metadata: unknown): unknown {
  try {
    decorate(metadata as WorkerMetadata);
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('@Worker', () => {
  it('names the worker after its class, restarts it with the default waits and gives it a 15 s lease', () => {
    expect(workerMetadataOf(decorate({ scope: 'machine' }))).toEqual({
      name: 'InboxWatcher',
      scope: 'machine',
      restart: { minDelayMs: 1_000, maxDelayMs: 60_000, factor: 2 },
      leaseMs: 15_000,
    });
  });

  it.each(['process', 'machine', 'workspace', 'cluster'] as const)('accepts scope: %p', (scope) => {
    expect(workerMetadataOf(decorate({ scope }))?.scope).toBe(scope);
  });

  it('keeps an explicit name and leaseMs', () => {
    const metadata = workerMetadataOf(decorate({ name: 'inbox', scope: 'cluster', leaseMs: 5_000 }));

    expect(metadata).toMatchObject({ name: 'inbox', scope: 'cluster', leaseMs: 5_000 });
  });

  it('keeps restart: false', () => {
    expect(workerMetadataOf(decorate({ scope: 'process', restart: false }))?.restart).toBe(false);
  });

  it('fills the waits a restart leaves out', () => {
    expect(workerMetadataOf(decorate({ scope: 'process', restart: {} }))?.restart).toEqual({
      minDelayMs: 1_000,
      maxDelayMs: 60_000,
      factor: 2,
    });
    expect(workerMetadataOf(decorate({ scope: 'process', restart: { minDelayMs: 50, factor: 1.5 } }))?.restart).toEqual(
      { minDelayMs: 50, maxDelayMs: 60_000, factor: 1.5 },
    );
    expect(
      workerMetadataOf(decorate({ scope: 'process', restart: { minDelayMs: 200, maxDelayMs: 200, factor: 1 } }))
        ?.restart,
    ).toEqual({ minDelayMs: 200, maxDelayMs: 200, factor: 1 });
  });

  it.each([
    [{}, 'scope', "scope must be 'process', 'machine', 'workspace' or 'cluster'"],
    [{ scope: 'galaxy' }, 'scope', "scope must be 'process', 'machine', 'workspace' or 'cluster'"],
    [{ scope: 'machine', name: '' }, 'name', 'name must not be empty'],
    [{ scope: 'machine', name: 5 }, 'name', 'name must be a string'],
    [{ scope: 'machine', restart: true }, 'restart', 'restart must be false or { minDelayMs, maxDelayMs, factor }'],
    [{ scope: 'machine', restart: 'always' }, 'restart', 'restart must be false or { minDelayMs, maxDelayMs, factor }'],
    [{ scope: 'machine', restart: null }, 'restart', 'restart must be false or { minDelayMs, maxDelayMs, factor }'],
    [{ scope: 'machine', restart: { minDelayMs: 0 } }, 'restart.minDelayMs', 'restart.minDelayMs must be at least 1'],
    [
      { scope: 'machine', restart: { minDelayMs: 1.5 } },
      'restart.minDelayMs',
      'restart.minDelayMs must be a whole number of milliseconds',
    ],
    [
      { scope: 'machine', restart: { minDelayMs: '1s' } },
      'restart.minDelayMs',
      'restart.minDelayMs must be a number of milliseconds',
    ],
    [{ scope: 'machine', restart: { maxDelayMs: 0 } }, 'restart.maxDelayMs', 'restart.maxDelayMs must be at least 1'],
    [
      { scope: 'machine', restart: { maxDelayMs: 3_000_000_000 } },
      'restart.maxDelayMs',
      'restart.maxDelayMs must be at most 2147483647 ms (about 24.8 days)',
    ],
    [
      { scope: 'machine', restart: { minDelayMs: 5_000, maxDelayMs: 1_000 } },
      'restart.minDelayMs',
      'restart.minDelayMs must not be greater than restart.maxDelayMs',
    ],
    [{ scope: 'machine', restart: { factor: 0.5 } }, 'restart.factor', 'restart.factor must be at least 1'],
    [{ scope: 'machine', restart: { factor: '2' } }, 'restart.factor', 'restart.factor must be a number'],
    [{ scope: 'machine', restart: { jitter: true } }, 'restart', 'Unrecognized key: "jitter"'],
    [
      { scope: 'machine', leaseMs: 500 },
      'leaseMs',
      'leaseMs must be at least 1000 (stores keep a TTL in whole seconds)',
    ],
    [{ scope: 'machine', leaseMs: 1_000.5 }, 'leaseMs', 'leaseMs must be a whole number of milliseconds'],
    [
      { scope: 'process', leaseMs: 5_000 },
      'leaseMs',
      "leaseMs applies to a leased scope; a 'process' worker has no lease",
    ],
    [{ scope: 'machine', every: '1m' }, '', 'Unrecognized key: "every"'],
  ])('refuses %j with InvalidDecoratorMetadataError on %p', (metadata, field, message) => {
    const error = decorationError(metadata);
    expect(error).toBeInstanceOf(InvalidDecoratorMetadataError);
    expect((error as Error).message).toBe(`@Worker invalid metadata for "${field}": ${message}`);
  });

  it('refuses a class without a run() method', () => {
    const decorateWithoutRun = () => {
      // @ts-expect-error a worker needs run()
      @Worker({ scope: 'process' })
      class NoRunWorker {}
      return NoRunWorker;
    };
    expect(decorateWithoutRun).toThrow(InvalidDecoratorMetadataError);
    expect(decorateWithoutRun).toThrow('@Worker invalid metadata for "run": NoRunWorker has no run() method');
  });

  it('reads no worker metadata from other values', () => {
    class PlainProvider {}
    expect(workerMetadataOf(new PlainProvider())).toBeUndefined();
    expect(workerMetadataOf(undefined)).toBeUndefined();
    expect(workerMetadataOf('text')).toBeUndefined();
  });
});
