import { SessionClaimConflictError } from '../transport.errors';

describe('SessionClaimConflictError', () => {
  it('names the session by the first 20 characters of its ID, keeping its code', () => {
    const sessionId = 'a'.repeat(20) + 'rest-of-the-session-id';
    const error = new SessionClaimConflictError(sessionId);

    expect(error.message).toBe(`Session ${'a'.repeat(20)} claimed by another pod`);
    expect(JSON.stringify(error)).not.toContain('rest-of-the-session-id');
    expect(error.code).toBe('SESSION_CLAIM_CONFLICT');
  });
});
