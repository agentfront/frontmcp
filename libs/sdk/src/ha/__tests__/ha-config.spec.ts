import { HA_ENV, resolveHaConfigFromEnv } from '../ha-config';

describe('resolveHaConfigFromEnv', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const name of Object.values(HA_ENV)) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('is empty when nothing is set', () => {
    expect(resolveHaConfigFromEnv()).toEqual({});
  });

  it('reads every HA setting', () => {
    process.env[HA_ENV.heartbeatIntervalMs] = '2000';
    process.env[HA_ENV.heartbeatTtlMs] = '6000';
    process.env[HA_ENV.takeoverGracePeriodMs] = '1500';
    process.env[HA_ENV.redisKeyPrefix] = ' app:ha: ';

    expect(resolveHaConfigFromEnv()).toEqual({
      heartbeatIntervalMs: 2000,
      heartbeatTtlMs: 6000,
      takeoverGracePeriodMs: 1500,
      redisKeyPrefix: 'app:ha:',
    });
  });

  it('ignores invalid values so the defaults apply', () => {
    process.env[HA_ENV.heartbeatIntervalMs] = 'fast';
    process.env[HA_ENV.heartbeatTtlMs] = '-5';
    process.env[HA_ENV.takeoverGracePeriodMs] = '1.5';
    process.env[HA_ENV.redisKeyPrefix] = '   ';

    expect(resolveHaConfigFromEnv()).toEqual({});

    process.env[HA_ENV.heartbeatIntervalMs] = '  ';
    expect(resolveHaConfigFromEnv()).toEqual({});
  });
});
