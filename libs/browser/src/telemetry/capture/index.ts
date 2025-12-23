// file: libs/browser/src/telemetry/capture/index.ts
/**
 * Capture Modules
 *
 * Event capture modules for different telemetry categories.
 */

export { createInteractionCapture, type InteractionCaptureOptions } from './interaction-capture';
export { createNetworkCapture, type NetworkCaptureOptions } from './network-capture';
export { createErrorCapture, captureError, type ErrorCaptureOptions } from './error-capture';
export { createLogCapture, type LogCaptureOptions } from './log-capture';
