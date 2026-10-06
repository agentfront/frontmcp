/**
 * The "no TracerProvider configured" warning (#766) asked whether the global provider's
 * constructor was named ProxyTracerProvider, which it always is, registered or not.
 */
import * as api from '@opentelemetry/api';
import * as sdkTraceBase from '@opentelemetry/sdk-trace-base';
import { BasicTracerProvider, InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';

import { hasRegisteredTracerProvider, registerExportingTracerProvider } from '../tracer-provider.utils';

describe('hasRegisteredTracerProvider', () => {
  afterEach(() => {
    api.trace.disable();
  });

  it('is false when nothing is registered', () => {
    expect(hasRegisteredTracerProvider(api)).toBe(false);
  });

  it('is true once a provider is registered globally', () => {
    api.trace.setGlobalTracerProvider(new BasicTracerProvider());

    expect(hasRegisteredTracerProvider(api)).toBe(true);
  });
});

describe('registerExportingTracerProvider', () => {
  afterEach(() => {
    api.trace.disable();
  });

  it('registers a provider that exports each span as it ends, on @opentelemetry/sdk-trace-base 2.x', () => {
    const exporter = new InMemorySpanExporter();

    registerExportingTracerProvider(api, sdkTraceBase, exporter);
    api.trace.getTracer('test').startSpan('checked').end();

    expect(hasRegisteredTracerProvider(api)).toBe(true);
    expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual(['checked']);
  });
});
