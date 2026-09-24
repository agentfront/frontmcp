import { AuthorityDeniedError } from '@frontmcp/auth';
import { McpError } from '@frontmcp/protocol';

import { FlowControl } from '../../../common';
import {
  GenericServerError,
  InternalMcpError,
  PublicMcpError,
  ResourceNotFoundError,
  UnauthorizedError,
} from '../../../errors';
import { AuthorityDeniedMcpError } from '../../../errors/mcp.error';
import { errorBehindFlowControl, toReportedError, toSdkMcpError } from '../mcp-error.utils';

function thrownFlowControl(raise: () => never): FlowControl {
  try {
    raise();
  } catch (error) {
    return error as FlowControl;
  }
}

describe('errorBehindFlowControl', () => {
  it('returns the error passed to this.fail()', () => {
    const original = new PublicMcpError('Order is archived');

    expect(errorBehindFlowControl(thrownFlowControl(() => FlowControl.fail(original)))).toBe(original);
  });

  it('returns an internal error for any other early exit', () => {
    const error = errorBehindFlowControl(thrownFlowControl(() => FlowControl.abort('stopped')));

    expect(error).toBeInstanceOf(InternalMcpError);
    expect((error as InternalMcpError).message).toBe('Flow ended with: abort');
  });

  it('returns other errors as they are', () => {
    const error = new Error('boom');

    expect(errorBehindFlowControl(error)).toBe(error);
  });
});

describe('toReportedError', () => {
  it('keeps a protocol McpError', () => {
    const error = new McpError(-32601, 'Method not found');

    expect(toReportedError(error)).toBe(error);
  });

  it('keeps a FrontMCP error with a JSON-RPC shape', () => {
    const notFound = new ResourceNotFoundError('orders://1');

    expect(toReportedError(notFound)).toBe(notFound);
  });

  it('turns an authorities refusal into a FrontMCP error with an error id', () => {
    const denied = new AuthorityDeniedError({ entryType: 'Tool', entryName: 'delete_user', deniedBy: 'roles' });

    expect(toReportedError(denied)).toBeInstanceOf(AuthorityDeniedMcpError);
  });

  it('turns a plain error into the FrontMCP error that is logged and answered with', () => {
    expect(toReportedError(new Error('db down'))).toBeInstanceOf(GenericServerError);
  });
});

describe('toSdkMcpError', () => {
  const originalNodeEnv = process.env['NODE_ENV'];

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = originalNodeEnv;
  });

  it('keeps a protocol McpError', () => {
    const error = new McpError(-32601, 'Method not found');

    expect(toSdkMcpError(error)).toBe(error);
  });

  it('uses the JSON-RPC shape an error declares, with the error id that was logged', () => {
    const notFound = new ResourceNotFoundError('orders://1');

    const error = toSdkMcpError(toReportedError(notFound));

    expect(error.code).toBe(-32002);
    expect(error.data).toEqual({ uri: 'orders://1', errorId: notFound.errorId });
  });

  it('answers an authorities refusal with its code and data, and the error id that was logged', () => {
    const denied = new AuthorityDeniedError({ entryType: 'Tool', entryName: 'delete_user', deniedBy: 'roles' });
    const reported = toReportedError(denied) as AuthorityDeniedMcpError;

    const error = toSdkMcpError(reported);

    expect(error.code).toBe(-32003);
    expect(error.data).toEqual({
      entryType: 'Tool',
      entryName: 'delete_user',
      deniedBy: 'roles',
      errorId: reported.errorId,
    });
  });

  it('answers a public error with its message and a code from its status', () => {
    const invalid = toSdkMcpError(new PublicMcpError('Text is too long', 'TOO_LONG', 400));
    const unauthorized = toSdkMcpError(new UnauthorizedError());

    expect(invalid.code).toBe(-32602);
    expect(invalid.message).toContain('Text is too long');
    expect(invalid.data).toMatchObject({ code: 'TOO_LONG' });
    expect(unauthorized.code).toBe(-32001);
  });

  it('answers the error passed to this.fail()', () => {
    const failure = thrownFlowControl(() => FlowControl.fail(new PublicMcpError('Order is archived')));

    expect(toSdkMcpError(failure).message).toContain('Order is archived');
  });

  it('hides an internal message in production and keeps the error id', () => {
    process.env['NODE_ENV'] = 'production';
    const internal = new InternalMcpError('connect ECONNREFUSED 10.0.3.7:5432');

    const error = toSdkMcpError(internal);

    expect(error.code).toBe(-32603);
    expect(error.message).not.toContain('ECONNREFUSED');
    expect(error.message).toContain(internal.errorId);
    expect(error.data).toMatchObject({ errorId: internal.errorId });
  });

  it('keeps an internal message outside production', () => {
    process.env['NODE_ENV'] = 'development';

    expect(toSdkMcpError(new Error('connect ECONNREFUSED')).message).toContain('ECONNREFUSED');
  });
});
