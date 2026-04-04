export { TelemetryAccessor, TelemetrySpan } from './telemetry.accessor';
export { TELEMETRY_ACCESSOR } from './telemetry.tokens';

// Side-effect import: declares module augmentation for TypeScript
import './telemetry.context-extension';
