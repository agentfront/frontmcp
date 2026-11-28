import { SessionClaimConflictError, SessionEndUnconfirmedError } from '../transport.errors';

describe('SessionClaimConflictError', () => {
  it('names the session by the first 20 characters of its ID, keeping its code', () => {
    const sessionId = 'a'.repeat(20) + 'rest-of-the-session-id';
    const error = new SessionClaimConflictError(sessionId);

    expect(error.message).toBe(`Session ${'a'.repeat(20)} claimed by another pod`);
    expect(JSON.stringify(error)).not.toContain('rest-of-the-session-id');
    expect(error.code).toBe('SESSION_CLAIM_CONFLICT');
  });
});

describe('SessionEndUnconfirmedError', () => {
  it('is a retryable 503 that names no instance to the client', () => {
    const error = new SessionEndUnconfirmedError('node-secret-7', 2.2, 'no answer within 5000ms', 'timed-out');

    expect(error.statusCode).toBe(503);
    expect(error.code).toBe('SESSION_END_UNCONFIRMED');
    expect(error.retryAfterSeconds).toBe(3);
    expect(error.getPublicMessage()).toContain('Retry the DELETE after 3s');
    expect(error.getPublicMessage()).not.toContain('node-secret-7');
    expect(error).toEqual(expect.objectContaining({ holder: 'node-secret-7', kind: 'timed-out' }));
  });

  it('asks for a retry after at least one second', () => {
    expect(new SessionEndUnconfirmedError('node-1', 0, 'nobody listens', 'not-listening').retryAfterSeconds).toBe(1);
  });
});
