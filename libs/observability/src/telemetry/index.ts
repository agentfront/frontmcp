// Side-effect import: declares module augmentation for TypeScript
import './telemetry.context-extension';

export { TelemetryAccessor, TelemetrySpan } from './telemetry.accessor';
export { TELEMETRY_ACCESSOR, TELEMETRY_FACTORY } from './telemetry.tokens';
export { TelemetryFactory } from './telemetry.factory';
export {
  createCounter,
  getMetricSnapshot,
  getCounterTotal,
  resetMetricSnapshot,
  resetTelemetrySnapshotForTesting,
  resetCounterCacheForTesting,
  normalizeBundleSource,
  normalizeErrorReason,
  KNOWN_BUNDLE_SOURCES,
  KNOWN_ERROR_REASONS,
} from './telemetry.counters';
export type { TelemetryCounter, CounterSnapshotEntry, KnownBundleSource, KnownErrorReason } from './telemetry.counters';
