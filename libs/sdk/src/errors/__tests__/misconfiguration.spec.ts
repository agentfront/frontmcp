import { JwtSecretRequiredError, SessionSecretRequiredError } from '../index';
import {
  describeConfigIssues,
  findMisconfiguration,
  MISCONFIGURATION_REMEDIES,
  misconfigurationBody,
} from '../misconfiguration';

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

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'does not treat the inherited key %s as a misconfiguration code',
    (code) => {
      const err = Object.assign(new Error('boom'), { code });
      expect(findMisconfiguration(err)).toBeUndefined();
    },
  );

  it('ignores ordinary errors and never echoes the message', () => {
    expect(findMisconfiguration(new Error('secret=abc'))).toBeUndefined();
    expect(findMisconfiguration('nope')).toBeUndefined();
    expect(Object.keys(MISCONFIGURATION_REMEDIES)).toContain('SESSION_SECRET_REQUIRED');
  });
});

describe('describeConfigIssues (#769)', () => {
  it('names each invalid field of a ZodError in the cause chain', () => {
    const zodError = Object.assign(new Error('[...]'), {
      name: 'ZodError',
      issues: [
        { path: ['apps'], message: 'Invalid input: expected array, received undefined' },
        { path: ['info', 'name'], message: 'Invalid input: expected string, received number' },
        { path: [], message: 'Unrecognized key' },
      ],
    });
    expect(describeConfigIssues(new Error('build failed', { cause: zodError }))).toBe(
      'apps: Invalid input: expected array, received undefined; ' +
        'info.name: Invalid input: expected string, received number; (root): Unrecognized key',
    );
  });

  it('reports a failed union through its closest branch', () => {
    const zodError = Object.assign(new Error('[...]'), {
      name: 'ZodError',
      issues: [
        {
          code: 'invalid_union',
          path: [],
          message: 'Invalid input',
          errors: [
            [{ path: ['apps'], message: 'Invalid input: expected array, received undefined' }],
            [
              { path: ['apps'], message: 'Invalid input: expected array, received undefined' },
              { path: ['splitByApp'], message: 'Invalid input: expected true' },
            ],
          ],
        },
      ],
    });
    expect(describeConfigIssues(zodError)).toBe('apps: Invalid input: expected array, received undefined');
  });

  it('returns undefined for any other failure', () => {
    expect(describeConfigIssues(new Error('connect ECONNREFUSED'))).toBeUndefined();
    expect(describeConfigIssues('not an error')).toBeUndefined();
  });
});
