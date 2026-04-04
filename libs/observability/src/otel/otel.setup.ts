/**
 * setupOTel() — convenience function for configuring the OpenTelemetry SDK.
 *
 * This is a thin wrapper around @opentelemetry/sdk-node's NodeSDK.
 * Users can also configure OTel themselves — the ObservabilityPlugin
 * only needs @opentelemetry/api to read the global tracer.
 *
 * All SDK packages are peer dependencies and lazy-loaded.
 */

import type { OTelSetupOptions } from './otel.types';

/**
 * Initialize the OpenTelemetry SDK with common defaults.
 *
 * This function lazy-loads @opentelemetry/sdk-node and exporter packages
 * to avoid bundling them unless explicitly called.
 *
 * @param options - Setup options (serviceName, exporter, endpoint)
 * @returns Shutdown function to gracefully stop the SDK
 *
 * @example
 * ```typescript
 * const shutdown = setupOTel({
 *   serviceName: 'my-mcp-server',
 *   exporter: 'otlp',
 *   endpoint: 'http://localhost:4318',
 * });
 *
 * // On process exit:
 * await shutdown();
 * ```
 */
export function setupOTel(options?: OTelSetupOptions): () => Promise<void> {
  const serviceName = options?.serviceName ?? process.env['OTEL_SERVICE_NAME'] ?? 'frontmcp-server';

  const exporterType = options?.exporter ?? 'console';

  const endpoint = options?.endpoint ?? process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://localhost:4318';

  let traceExporter: unknown;

  if (exporterType === 'otlp') {
    try {
      const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
      traceExporter = new OTLPTraceExporter({ url: `${endpoint}/v1/traces` });
    } catch {
      throw new Error(
        'setupOTel: @opentelemetry/exporter-trace-otlp-http is required for OTLP export. ' +
          'Install it with: npm install @opentelemetry/exporter-trace-otlp-http',
      );
    }
  } else if (exporterType === 'console') {
    const { ConsoleSpanExporter } = require('@opentelemetry/sdk-trace-base');
    traceExporter = new ConsoleSpanExporter();
  }

  try {
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    const { Resource } = require('@opentelemetry/resources');
    const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = require('@opentelemetry/semantic-conventions');

    const resource = new Resource({
      [ATTR_SERVICE_NAME]: serviceName,
      ...(options?.serviceVersion ? { [ATTR_SERVICE_VERSION]: options.serviceVersion } : {}),
    });

    const sdk = new NodeSDK({
      resource,
      traceExporter,
    });

    sdk.start();

    return async () => {
      await sdk.shutdown();
    };
  } catch {
    throw new Error(
      'setupOTel: @opentelemetry/sdk-node is required. ' +
        'Install it with: npm install @opentelemetry/sdk-node @opentelemetry/resources @opentelemetry/semantic-conventions',
    );
  }
}
