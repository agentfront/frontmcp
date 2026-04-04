/**
 * Testing utilities for @frontmcp/observability.
 *
 * Provides helpers to set up OTel tracing in tests and assert
 * on exported spans without boilerplate.
 *
 * @example
 * ```typescript
 * import { createTestTracer, getFinishedSpans, assertSpanExists } from '@frontmcp/observability/testing';
 *
 * describe('my tool', () => {
 *   const { tracer, exporter, cleanup } = createTestTracer();
 *
 *   afterEach(() => {
 *     exporter.reset();
 *   });
 *
 *   afterAll(async () => {
 *     await cleanup();
 *   });
 *
 *   it('should create a span', async () => {
 *     // ... invoke tool ...
 *     const spans = getFinishedSpans(exporter);
 *     assertSpanExists(spans, 'tool get_weather');
 *   });
 * });
 * ```
 */

import { type Tracer } from '@opentelemetry/api';

import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';

/**
 * Result from createTestTracer().
 */
export interface TestTracer {
  /** OTel Tracer instance (from the test provider, not global) */
  tracer: Tracer;

  /** In-memory span exporter — call .getFinishedSpans() to inspect */
  exporter: InMemorySpanExporter;

  /** The test TracerProvider */
  provider: BasicTracerProvider;

  /** Cleanup function — call in afterAll/afterEach to shutdown the provider */
  cleanup: () => Promise<void>;
}

/**
 * Create a test tracer with an in-memory span exporter.
 *
 * Does NOT register globally — uses provider.getTracer() directly
 * to avoid polluting the global tracer provider across tests.
 *
 * @param name - Tracer name (default: 'test')
 */
export function createTestTracer(name = 'test'): TestTracer {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider();
  provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
  const tracer = provider.getTracer(name);

  return {
    tracer,
    exporter,
    provider,
    cleanup: async () => {
      exporter.reset();
      await provider.forceFlush();
      await provider.shutdown();
    },
  };
}

/**
 * Get finished spans from an exporter.
 */
export function getFinishedSpans(exporter: InMemorySpanExporter): ReadableSpan[] {
  return exporter.getFinishedSpans();
}

/**
 * Assert that a span with the given name exists.
 *
 * @returns The matching span
 * @throws If no span with the name is found
 */
export function assertSpanExists(spans: ReadableSpan[], name: string): ReadableSpan {
  const match = spans.find((s) => s.name === name);
  if (!match) {
    const names = spans.map((s) => s.name).join(', ');
    throw new Error(`Expected span "${name}" but found: [${names}]`);
  }
  return match;
}

/**
 * Assert that a span has a specific attribute value.
 */
export function assertSpanAttribute(span: ReadableSpan, key: string, value: string | number | boolean): void {
  const actual = span.attributes[key];
  if (actual !== value) {
    throw new Error(
      `Expected span "${span.name}" attribute "${key}" to be ${JSON.stringify(value)} but got ${JSON.stringify(actual)}`,
    );
  }
}

/**
 * Find a span by name.
 */
export function findSpan(spans: ReadableSpan[], name: string): ReadableSpan | undefined {
  return spans.find((s) => s.name === name);
}

/**
 * Find all spans with a specific attribute value.
 */
export function findSpansByAttribute(
  spans: ReadableSpan[],
  key: string,
  value: string | number | boolean,
): ReadableSpan[] {
  return spans.filter((s) => s.attributes[key] === value);
}
