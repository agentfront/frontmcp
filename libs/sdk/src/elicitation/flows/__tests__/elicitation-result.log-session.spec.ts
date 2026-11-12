import ElicitationResultFlow from '../elicitation-result.flow';

const SESSION_ID = 'session-that-resumes-a-transport';

describe('ElicitationResultFlow validateContent', () => {
  it('logs an answer that fails its schema without the session ID', async () => {
    const warn = jest.fn();
    const logger = { verbose: jest.fn(), warn };
    const flow = {
      logger,
      state: {
        action: 'accept',
        content: { age: 'not a number' },
        pendingRecord: {
          elicitId: 'elicit-1',
          sessionId: SESSION_ID,
          mode: 'form',
          requestedSchema: { type: 'object', properties: { age: { type: 'number' } }, required: ['age'] },
        },
      },
    };

    await expect(ElicitationResultFlow.prototype.validateContent.call(flow)).rejects.toThrow();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SESSION_ID);
    expect(warn.mock.calls[0][1]).toEqual(expect.objectContaining({ sessionIdHash: expect.any(String) }));
  });
});
