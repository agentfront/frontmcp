import { InternalMcpError, MCP_ERROR_CODES, PublicMcpError } from './mcp.error';

/** A persistent question has no answer yet: it stays in the inbox, and the next call that asks it gets the answer. */
export class QuestionPendingError extends PublicMcpError {
  readonly key: string;
  readonly expiresAt: number;

  constructor(key: string, expiresAt: number) {
    super(
      `The question "${key}" has no answer yet. It waits in the inbox until ${new Date(expiresAt).toISOString()}; ` +
        'call again to get its answer.',
      'QUESTION_PENDING',
      408,
    );
    this.key = key;
    this.expiresAt = expiresAt;
  }
}

/** A newer call of the same caller asked the question, and waits for its answer instead of this one. */
export class QuestionSupersededError extends PublicMcpError {
  readonly key: string;

  constructor(key: string) {
    super(`A newer call asked the question "${key}" and waits for its answer instead.`, 'QUESTION_SUPERSEDED', 409);
    this.key = key;
  }
}

/** No question with this id is waiting for the person answering: it never was, it expired, or it is another's. */
export class QuestionNotFoundError extends PublicMcpError {
  readonly mcpErrorCode = MCP_ERROR_CODES.RESOURCE_NOT_FOUND;

  constructor() {
    super('No such question.', 'QUESTION_NOT_FOUND', 404);
  }
}

/** The question was answered already: its first answer is the one its call gets. */
export class QuestionAlreadyAnsweredError extends PublicMcpError {
  constructor() {
    super('This question was answered already.', 'QUESTION_ALREADY_ANSWERED', 409);
  }
}

/** Other writers kept changing a question while this call tried to change it. */
export class QuestionStoreBusyError extends InternalMcpError {
  constructor() {
    super('The question changed under every attempt to update it; try again.', 'QUESTION_STORE_BUSY');
  }
}

/** Thrown at boot for an `elicitation.persistent` store the server cannot open or use. */
export class InvalidQuestionStoreError extends InternalMcpError {
  constructor(reason: string) {
    super(`elicitation.persistent: ${reason}`, 'INVALID_QUESTION_STORE');
  }
}
