/**
 * The "no TracerProvider configured" warning (#766) asked whether the global provider's
 * constructor was named ProxyTracerProvider, which it always is, registered or not.
 */
import * as api from '@opentelemetry/api';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';

import { hasRegisteredTracerProvider } from '../tracer-provider.utils';

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
