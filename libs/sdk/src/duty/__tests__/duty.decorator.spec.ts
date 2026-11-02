import 'reflect-metadata';

import { Duty, dutyMetadataOf, type DutyMetadata, type DutyRunContext } from '../../common';
import { InvalidDecoratorMetadataError } from '../../errors';

function decorate(metadata: DutyMetadata): object {
  @Duty(metadata)
  class SweepDuty {
    run(_context: DutyRunContext): void {
      return undefined;
    }
  }
  return new SweepDuty();
}

function decorationError(metadata: unknown): unknown {
  try {
    decorate(metadata as DutyMetadata);
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('@Duty', () => {
  it.each([
    [250, 250],
    ['250ms', 250],
    ['30s', 30_000],
    ['5m', 300_000],
    ['2h', 7_200_000],
    ['1d', 86_400_000],
  ])('reads every: %p as %p ms', (every, everyMs) => {
    expect(dutyMetadataOf(decorate({ every, scope: 'machine' }))).toMatchObject({ everyMs });
  });

  it('names the duty after its class unless named, and keeps the scope', () => {
    expect(dutyMetadataOf(decorate({ every: '1m', scope: 'workspace' }))).toEqual({
      name: 'SweepDuty',
      everyMs: 60_000,
      scope: 'workspace',
      leaseMs: 60_000,
    });
    expect(dutyMetadataOf(decorate({ name: 'sweep-cache', every: '1m', scope: 'machine' }))?.name).toBe('sweep-cache');
  });

  it.each([
    [100, 3_000],
    [1_500, 4_500],
    [10_000, 30_000],
    [3_600_000, 60_000],
  ])('gives every: %p a lease of %p ms by default (three intervals, between 3 s and 60 s)', (every, leaseMs) => {
    expect(dutyMetadataOf(decorate({ every, scope: 'machine' }))?.leaseMs).toBe(leaseMs);
  });

  it('keeps an explicit leaseMs', () => {
    expect(dutyMetadataOf(decorate({ every: '1h', scope: 'machine', leaseMs: 5_000 }))?.leaseMs).toBe(5_000);
  });

  it.each([
    [{ every: '5x', scope: 'machine' }, 'every', 'every must be milliseconds or a duration such as "30s", "5m", "1h"'],
    [{ every: 0, scope: 'machine' }, 'every', 'every must be greater than 0'],
    [{ every: -5, scope: 'machine' }, 'every', 'every must be greater than 0'],
    [{ every: 1.5, scope: 'machine' }, 'every', 'every must be a whole number of milliseconds'],
    [{ every: '30d', scope: 'machine' }, 'every', 'every must be at most 2147483647 ms (about 24.8 days)'],
    [{ every: '1m', scope: 'galaxy' }, 'scope', "scope must be 'machine' or 'workspace'"],
    [{ every: '1m' }, 'scope', "scope must be 'machine' or 'workspace'"],
    [
      { every: '1m', scope: 'machine', leaseMs: 500 },
      'leaseMs',
      'leaseMs must be at least 1000 (stores keep a TTL in whole seconds)',
    ],
    [{ every: '1m', scope: 'machine', leaseMs: 1_000.5 }, 'leaseMs', 'leaseMs must be a whole number of milliseconds'],
    [{ every: '1m', scope: 'machine', name: '' }, 'name', 'name must not be empty'],
    [{ every: '1m', scope: 'machine', cron: '* * * * *' }, '', 'Unrecognized key: "cron"'],
  ])('refuses %j with InvalidDecoratorMetadataError on %p', (metadata, field, message) => {
    const error = decorationError(metadata);
    expect(error).toBeInstanceOf(InvalidDecoratorMetadataError);
    expect((error as Error).message).toBe(`@Duty invalid metadata for "${field}": ${message}`);
  });

  it('refuses a class without a run() method', () => {
    const decorateWithoutRun = () => {
      // @ts-expect-error a duty needs run()
      @Duty({ every: '1m', scope: 'machine' })
      class NoRunDuty {}
      return NoRunDuty;
    };
    expect(decorateWithoutRun).toThrow(InvalidDecoratorMetadataError);
    expect(decorateWithoutRun).toThrow('@Duty invalid metadata for "run": NoRunDuty has no run() method');
  });

  it('reads no duty metadata from other values', () => {
    class PlainProvider {}
    expect(dutyMetadataOf(new PlainProvider())).toBeUndefined();
    expect(dutyMetadataOf(undefined)).toBeUndefined();
    expect(dutyMetadataOf('text')).toBeUndefined();
  });
});
