import { InternalMcpError, PublicMcpError } from '@frontmcp/sdk';

/** A handle that expired, was never issued, or is another session's or caller's: all answer alike. */
export class ResultHandleNotFoundError extends PublicMcpError {
  override readonly name = 'ResultHandleNotFoundError';

  constructor(handle: string) {
    super(
      `No result for handle "${handle}": it expired, or it belongs to another session or caller.`,
      'RESULT_HANDLE_NOT_FOUND',
      404,
      undefined,
      { say: 'Call the tool again for a new handle.' },
    );
  }
}

/** A `result_query` path that is not a dot path or a JSON pointer, or that names nothing in the result. */
export class ResultPathNotFoundError extends PublicMcpError {
  override readonly name = 'ResultPathNotFoundError';

  constructor(path: string) {
    super(`No value at path "${path}" in this result.`, 'RESULT_PATH_NOT_FOUND', 404, undefined, {
      say: 'Use a dot path ($.rows[2].title) or a JSON pointer (/rows/2/title) through the keys the shape lists.',
    });
  }
}

/** A `result_query` slice larger than the fold threshold: sending it whole would undo the fold. */
export class ResultSliceTooLargeError extends PublicMcpError {
  override readonly name = 'ResultSliceTooLargeError';

  constructor(bytes: number, thresholdBytes: number) {
    super(
      `This slice is ${bytes} bytes, over the ${thresholdBytes}-byte limit of a result_query answer.`,
      'RESULT_SLICE_TOO_LARGE',
      413,
      undefined,
      { say: 'Read fewer items, fewer fields or a deeper path.' },
    );
  }
}

/** Raised when `ResultHandlesPlugin.init()` is given options it cannot honour. */
export class ResultHandlesConfigurationError extends InternalMcpError {
  override readonly name = 'ResultHandlesConfigurationError';

  constructor(message: string) {
    super(message, 'RESULT_HANDLES_CONFIGURATION');
  }
}
