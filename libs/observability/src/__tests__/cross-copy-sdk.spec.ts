/**
 * Failures raised by another copy of `@frontmcp/sdk` are recorded as the client got them (#802).
 *
 * In an ES-module project the SDK's ESM build loads this package with `require()`, which resolves its
 * CommonJS build, which loads the SDK's CommonJS build: the flows run on one copy of the SDK while
 * these hooks import another. `instanceof FlowControl` and `toMcpError()` did not recognise the other
 * copy's classes, so a `PublicMcpError` passed to `this.fail()` was recorded as `GenericServerError`
 * with a new error id, and the span's exception carried `FlowControl`'s stack.
 *
 * `jest.isolateModules` loads the copy the flows run on, as Node loads the second build.
 */
import 'reflect-metadata';

import { diag, DiagLogLevel, SpanStatusCode, trace } from '@opentelemetry/api';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';

import { FlowControl, PublicMcpError } from '@frontmcp/sdk';

import { flowFailureOf, runInHookSpan } from '../plugin/observability.hooks';

type Sdk = typeof import('@frontmcp/sdk');

function loadFlowsCopy(): Sdk {
  let copy: Sdk | undefined;
  jest.isolateModules(() => {
    copy = jest.requireActual<Sdk>('@frontmcp/sdk');
  });
  if (!copy) throw new Error('the second copy of the SDK did not load');
  return copy;
}

const flowsSdk = loadFlowsCopy();

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
diag.setLogger({ debug() {}, info() {}, warn() {}, error() {}, verbose() {} }, DiagLogLevel.NONE);
trace.setGlobalTracerProvider(provider);

afterAll(async () => {
  await provider.shutdown();
});

/** What the flow state carries after `this.fail(error)` in the copy the flows run on. */
function failedWith(error: Error): unknown {
  try {
    flowsSdk.FlowControl.fail(error);
  } catch (signal) {
    return signal;
  }
  throw new Error('FlowControl.fail did not throw');
}

describe('a failure raised by another copy of the SDK (#802)', () => {
  it('runs against a genuinely separate copy', () => {
    expect(flowsSdk.FlowControl).not.toBe(FlowControl);
    expect(flowsSdk.PublicMcpError).not.toBe(PublicMcpError);
  });

  it('records a PublicMcpError passed to this.fail() with the public message and the client error id', () => {
    const original = new flowsSdk.PublicMcpError('no such ticket');
    const answered = flowsSdk.formatMcpErrorResponse(original, false);

    const failure = flowFailureOf(failedWith(original));

    expect(failure).toEqual({
      error: original,
      type: 'PublicMcpError',
      message: 'no such ticket',
      code: 'PUBLIC_ERROR',
      errorId: answered._meta?.errorId,
    });
  });

  it('records a thrown PublicMcpError subclass the same way', () => {
    const original = new flowsSdk.ToolNotFoundError('close_ticket');

    expect(flowFailureOf(original)).toMatchObject({
      type: 'ToolNotFoundError',
      message: 'Tool "close_ticket" not found',
      code: 'TOOL_NOT_FOUND',
      errorId: original.errorId,
    });
  });

  it('records a plain error with the error id the client was answered with', () => {
    const original = new Error('database unreachable');
    const answered = flowsSdk.formatMcpErrorResponse(original, false);

    const failure = flowFailureOf(failedWith(original));

    expect(failure).toMatchObject({ type: 'GenericServerError', code: 'SERVER_ERROR' });
    expect(failure.errorId).toBe(answered._meta?.errorId);
    expect(failure.message).toBe(answered.content[0].text);
  });

  it("puts the real error's stack on the hook span, not FlowControl's", async () => {
    exporter.reset();
    const original = new flowsSdk.PublicMcpError('no such ticket');

    await expect(
      runInHookSpan({ state: {} }, { flowName: 'tools:call-tool', stage: 'execute' }, async () => {
        flowsSdk.FlowControl.fail(original);
      }),
    ).rejects.toBeInstanceOf(flowsSdk.FlowControl);

    const [span] = exporter.getFinishedSpans();
    expect(span.status).toEqual({ code: SpanStatusCode.ERROR, message: 'no such ticket' });
    const exception = span.events.find((event) => event.name === 'exception');
    expect(exception?.attributes).toMatchObject({
      // OpenTelemetry names the exception type after its `code` when it has one.
      'exception.type': 'PUBLIC_ERROR',
      'exception.message': 'no such ticket',
      'exception.stacktrace': original.stack,
    });
  });

  it("ends a hook span OK when the other copy's flow responds", async () => {
    exporter.reset();

    await expect(
      runInHookSpan({ state: {} }, { flowName: 'tools:call-tool', stage: 'execute' }, async () => {
        flowsSdk.FlowControl.respond({ content: [] });
      }),
    ).rejects.toBeInstanceOf(FlowControl);

    const [span] = exporter.getFinishedSpans();
    expect(span.status.code).not.toBe(SpanStatusCode.ERROR);
  });
});
