/**
 * Two copies of the SDK in one process recognise each other's errors and control-flow signals (#802).
 *
 * In an ES-module project the SDK's ESM build loads `@frontmcp/observability` with `require()`, which
 * loads the SDK's CommonJS build: a second copy of every class. Observability's `instanceof
 * FlowControl` and `toMcpError()` then did not recognise the ESM SDK's `FlowControl` and
 * `PublicMcpError`, and recorded every failure as an internal error with a new error id.
 *
 * `jest.isolateModules` loads the second copy here, as Node does for the two builds.
 */
import { DynamicPlugin, isDynamicPluginClass } from '../../common/dynamic/dynamic.plugin';
import { FlowControl } from '../../common/interfaces/flow.interface';
import {
  GenericServerError,
  InternalMcpError,
  isPublicError,
  McpError,
  PublicMcpError,
  toMcpError,
  ToolNotFoundError,
} from '../mcp.error';

type ErrorsModule = typeof import('../mcp.error');
type FlowModule = typeof import('../../common/interfaces/flow.interface');
type DynamicModule = typeof import('../../common/dynamic/dynamic.plugin');
type GuardModule = typeof import('@frontmcp/guard');
type AuthModule = typeof import('@frontmcp/auth');

interface SecondCopy {
  errors: ErrorsModule;
  flow: FlowModule;
  dynamic: DynamicModule;
  guard: GuardModule;
  auth: AuthModule;
}

function loadSecondCopy(): SecondCopy {
  let copy: SecondCopy | undefined;
  jest.isolateModules(() => {
    copy = {
      errors: jest.requireActual<ErrorsModule>('../mcp.error'),
      flow: jest.requireActual<FlowModule>('../../common/interfaces/flow.interface'),
      dynamic: jest.requireActual<DynamicModule>('../../common/dynamic/dynamic.plugin'),
      guard: jest.requireActual<GuardModule>('@frontmcp/guard'),
      auth: jest.requireActual<AuthModule>('@frontmcp/auth'),
    };
  });
  if (!copy) throw new Error('the second copy did not load');
  return copy;
}

const second = loadSecondCopy();

describe('SDK classes across two copies of the SDK (#802)', () => {
  it('loads a genuinely separate copy', () => {
    expect(second.errors.PublicMcpError).not.toBe(PublicMcpError);
    expect(second.flow.FlowControl).not.toBe(FlowControl);
  });

  it("recognises the other copy's PublicMcpError as a PublicMcpError and an McpError", () => {
    const foreign = new second.errors.PublicMcpError('no such ticket');

    expect(foreign).toBeInstanceOf(PublicMcpError);
    expect(foreign).toBeInstanceOf(McpError);
    expect(foreign instanceof InternalMcpError).toBe(false);
    expect(isPublicError(foreign)).toBe(true);
  });

  it('keeps subclass checks exact: a branded base does not make every subclass match', () => {
    const foreignPublic = new second.errors.PublicMcpError('x');
    const foreignNotFound = new second.errors.ToolNotFoundError('t');
    const foreignInternal = new second.errors.InternalMcpError('boom');

    expect(foreignPublic instanceof ToolNotFoundError).toBe(false);
    expect(foreignNotFound instanceof PublicMcpError).toBe(true);
    expect(foreignInternal instanceof InternalMcpError).toBe(true);
    expect(foreignInternal instanceof PublicMcpError).toBe(false);
    // An unbranded subclass keeps the plain check, so another copy's instance does not match it.
    expect(foreignNotFound instanceof ToolNotFoundError).toBe(false);
    expect(new ToolNotFoundError('t') instanceof ToolNotFoundError).toBe(true);
  });

  it("maps the other copy's error to itself, with the client's error id", () => {
    const foreign = new second.errors.PublicMcpError('no such ticket');

    const reported = toMcpError(foreign);

    expect(reported).toBe(foreign);
    expect(reported.name).toBe('PublicMcpError');
    expect(reported.code).toBe('PUBLIC_ERROR');
    expect(reported.getPublicMessage()).toBe('no such ticket');
    expect(reported.errorId).toBe(foreign.errorId);
  });

  it('converts a plain error to the same MCP error in either copy', () => {
    const plain = new Error('database unreachable');

    const answered = second.errors.toMcpError(plain);
    const recorded = toMcpError(plain);

    expect(recorded).toBe(answered);
    expect(recorded).toBeInstanceOf(second.errors.GenericServerError);
    expect(recorded).toBeInstanceOf(InternalMcpError);
    expect(recorded.errorId).toBe(answered.errorId);
    expect(toMcpError(new Error('another failure'))).toBeInstanceOf(GenericServerError);
  });

  it("converts the other copy's guard and authority errors as that copy does", () => {
    const limited = new second.guard.GuardStorageUnavailableError('redis', new Error('down'), 'runtime');
    const denied = new second.auth.AuthorityDeniedError({ entryType: 'Tool', entryName: 'x', deniedBy: 'policy' });

    const answeredLimit = second.errors.toMcpError(limited);
    const answeredDenial = second.errors.toMcpError(denied);

    // The conversion is shared, so it must be the public error either copy would make.
    expect(toMcpError(limited)).toBe(answeredLimit);
    expect(toMcpError(denied)).toBe(answeredDenial);
    expect(answeredLimit).toMatchObject({ code: 'GUARD_STORAGE_UNAVAILABLE', statusCode: 503 });
    expect(answeredDenial).toMatchObject({ code: 'AUTHORITY_DENIED', statusCode: 403 });

    const recordedFirst = new second.guard.ConcurrencyLimitError('tool', 1);
    expect(toMcpError(recordedFirst)).toBeInstanceOf(PublicMcpError);
    expect(second.errors.toMcpError(recordedFirst)).toMatchObject({ code: 'CONCURRENCY_LIMIT', statusCode: 429 });
  });

  it("recognises the other copy's FlowControl and keeps the error it carries", () => {
    const original = new second.errors.PublicMcpError('no such ticket');
    let signal: unknown;
    try {
      second.flow.FlowControl.fail(original);
    } catch (error) {
      signal = error;
    }

    expect(signal).toBeInstanceOf(FlowControl);
    expect((signal as { originalError?: unknown }).originalError).toBe(original);
    expect(new FlowControl('respond', 1)).toBeInstanceOf(second.flow.FlowControl);
  });

  it("recognises a plugin class built on the other copy's DynamicPlugin", () => {
    class ForeignPlugin extends second.dynamic.DynamicPlugin<{ label?: string }> {}

    expect(isDynamicPluginClass(ForeignPlugin)).toBe(true);
    expect(new ForeignPlugin()).toBeInstanceOf(DynamicPlugin);
  });

  it('does not recognise unrelated values', () => {
    class McpErrorLookalike extends Error {
      readonly errorId = 'err_1';
      readonly code = 'PUBLIC_ERROR';
    }
    Object.defineProperty(McpErrorLookalike, 'name', { value: 'PublicMcpError' });

    expect(new McpErrorLookalike() instanceof McpError).toBe(false);
    expect(new Error('x') instanceof FlowControl).toBe(false);
    expect(Object.create(null) instanceof McpError).toBe(false);
    expect((undefined as unknown) instanceof McpError).toBe(false);
    expect(('PublicMcpError' as unknown) instanceof PublicMcpError).toBe(false);
  });
});
