import { haEnv } from '../ha-env';

describe('haEnv', () => {
  it('returns an empty object when no ha block is configured', () => {
    expect(haEnv(undefined)).toEqual({});
    expect(haEnv({})).toEqual({});
  });

  it('maps every ha setting to its FRONTMCP_HA_* variable', () => {
    expect(
      haEnv({
        heartbeatIntervalMs: 5000,
        heartbeatTtlMs: 15000,
        takeoverGracePeriodMs: 3000,
        redisKeyPrefix: 'app:ha:',
      }),
    ).toEqual({
      FRONTMCP_HA_HEARTBEAT_INTERVAL_MS: '5000',
      FRONTMCP_HA_HEARTBEAT_TTL_MS: '15000',
      FRONTMCP_HA_TAKEOVER_GRACE_MS: '3000',
      FRONTMCP_HA_KEY_PREFIX: 'app:ha:',
    });
  });

  it('only emits the settings that are present', () => {
    expect(haEnv({ heartbeatTtlMs: 9000 })).toEqual({ FRONTMCP_HA_HEARTBEAT_TTL_MS: '9000' });
  });
});
