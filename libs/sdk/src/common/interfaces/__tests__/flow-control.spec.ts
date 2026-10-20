import { FlowControl } from '../flow.interface';

function signal(run: () => never): FlowControl {
  try {
    run();
  } catch (e) {
    if (e instanceof FlowControl) return e;
    throw e;
  }
  throw new Error('expected a FlowControl');
}

describe('FlowControl', () => {
  it.each([
    ['respond', () => FlowControl.respond({ ok: true })],
    ['next', () => FlowControl.next()],
    ['handled', () => FlowControl.handled()],
  ] as const)('carries no stack frames for %s, which is not an error', (type, run) => {
    const control = signal(run);
    expect(control.type).toBe(type);
    expect(control).toBeInstanceOf(Error);
    expect(control.stack).not.toContain('\n    at ');
  });

  it('keeps the respond output', () => {
    expect(signal(() => FlowControl.respond({ ok: true })).output).toEqual({ ok: true });
  });

  it.each([
    ['fail', () => FlowControl.fail(new Error('boom'))],
    ['abort', () => FlowControl.abort('stop')],
  ] as const)('keeps the stack for %s', (type, run) => {
    const control = signal(run);
    expect(control.type).toBe(type);
    expect(control.stack).toContain('\n    at ');
  });

  it('keeps the original error of a fail', () => {
    const error = new Error('boom');
    const control = signal(() => FlowControl.fail(error));
    expect(control.output).toEqual({ error: 'boom' });
    expect((control as { originalError?: Error }).originalError).toBe(error);
  });

  it('leaves Error.stackTraceLimit as it found it', () => {
    const before = Error.stackTraceLimit;
    signal(() => FlowControl.respond(null));
    signal(() => FlowControl.abort('stop'));
    expect(Error.stackTraceLimit).toBe(before);
    expect(new Error('after').stack).toContain('\n    at ');
  });
});
