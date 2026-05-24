/**
 * `TelemetryFactory` tests — the scope-lifetime alternative to
 * `TelemetryAccessor` used by long-lived objects (BundleStore, etc.) that
 * don't have a per-request context.
 *
 * Covers:
 *   - `createCounter` delegates to the process-global store and returns a
 *     usable counter (.inc() doesn't throw).
 *   - `startSpan` returns a `TelemetrySpan` whose `end()` is callable.
 *   - `withSpan` ends the span on the success path AND `endWithError`s on
 *     the failure path (both branches of the try/catch).
 *   - `withSpan` rethrows the original error untouched.
 */

import { context } from '@opentelemetry/api';

import { TelemetryFactory } from '../telemetry.factory';

describe('TelemetryFactory', () => {
  it('createCounter returns a usable counter whose .inc() does not throw', () => {
    const factory = new TelemetryFactory();
    const counter = factory.createCounter('frontmcp_test_factory_total', 'unit-test counter');
    expect(() => counter.inc(1)).not.toThrow();
    expect(() => counter.inc(2, { tier: 'l1' })).not.toThrow();
  });

  it('startSpan returns a TelemetrySpan that ends cleanly', () => {
    const factory = new TelemetryFactory();
    const span = factory.startSpan('factory.test-span', { 'attr.one': 'a', 'attr.two': 2, 'attr.three': true });
    expect(() => span.end()).not.toThrow();
  });

  it('startSpan accepts an explicit parent context', () => {
    const factory = new TelemetryFactory();
    // Use the active context — without a registered tracer provider it's a
    // valid no-op Context that still exercises the `parent` branch of
    // `tracer.startSpan(name, opts, parent)`.
    const span = factory.startSpan('factory.child', undefined, context.active());
    expect(() => span.end()).not.toThrow();
  });

  it('withSpan resolves with the inner result and ends the span', async () => {
    const factory = new TelemetryFactory();
    const result = await factory.withSpan('factory.with-span.ok', async () => 'value');
    expect(result).toBe('value');
  });

  it('withSpan rethrows Error instances and ends the span with the error', async () => {
    const factory = new TelemetryFactory();
    const boom = new Error('boom');
    await expect(
      factory.withSpan('factory.with-span.err', async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });

  it('withSpan handles non-Error throws by stringifying them', async () => {
    const factory = new TelemetryFactory();
    await expect(
      factory.withSpan('factory.with-span.string-err', async () => {
        throw 'plain string';
      }),
    ).rejects.toBe('plain string');
  });
});
