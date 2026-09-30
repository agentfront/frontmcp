import { JwtSecretRequiredError, SessionSecretRequiredError } from '../index';
import { findMisconfiguration, MISCONFIGURATION_REMEDIES, misconfigurationBody } from '../misconfiguration';

describe('misconfiguration classification (#646)', () => {
  it('recognizes a missing session secret and names the setting', () => {
    const found = findMisconfiguration(new SessionSecretRequiredError('session-id encryption'));
    expect(found?.code).toBe('SESSION_SECRET_REQUIRED');
    expect(misconfigurationBody(found!)).toEqual({
      error: 'server_misconfigured',
      code: 'SESSION_SECRET_REQUIRED',
      message: expect.stringContaining('MCP_SESSION_SECRET'),
    });
  });

  it('recognizes a missing JWT secret', () => {
    expect(findMisconfiguration(new JwtSecretRequiredError('orchestrated'))?.code).toBe('JWT_SECRET_REQUIRED');
  });

  it('finds a fault wrapped in a cause chain', () => {
    const wrapped = new Error('boom', { cause: new SessionSecretRequiredError('x') });
    expect(findMisconfiguration(wrapped)?.code).toBe('SESSION_SECRET_REQUIRED');
  });

  it('maps a ZodError to CONFIG_INVALID', () => {
    const err = new Error('bad config');
    err.name = 'ZodError';
    expect(findMisconfiguration(err)?.code).toBe('CONFIG_INVALID');
  });

  it('ignores ordinary errors and never echoes the message', () => {
    expect(findMisconfiguration(new Error('secret=abc'))).toBeUndefined();
    expect(findMisconfiguration('nope')).toBeUndefined();
    expect(Object.keys(MISCONFIGURATION_REMEDIES)).toContain('SESSION_SECRET_REQUIRED');
  });
});
