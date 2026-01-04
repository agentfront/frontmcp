/**
 * W3C Trace Context Parser
 *
 * Parses distributed tracing headers according to W3C Trace Context specification.
 * Supports traceparent header with fallback to x-frontmcp-trace-id custom header.
 *
 * @see https://www.w3.org/TR/trace-context/
 */

import { randomUUID } from '@frontmcp/utils';

/**
 * W3C Trace Context parsed from traceparent header.
 * Format: 00-<trace-id>-<parent-id>-<trace-flags>
 */
export interface TraceContext {
  /** 128-bit trace identifier (32 hex chars) */
  traceId: string;
  /** 64-bit parent span identifier (16 hex chars) */
  parentId: string;
  /** 8-bit trace flags (sampled = 0x01) */
  traceFlags: number;
  /** Raw traceparent header value */
  raw: string;
}

/**
 * Parse trace context from HTTP headers.
 *
 * Priority:
 * 1. W3C traceparent header
 * 2. x-frontmcp-trace-id custom header
 * 3. Generate new trace context
 *
 * @param headers - HTTP headers object
 * @returns Parsed or generated TraceContext
 */
export function parseTraceContext(headers: Record<string, unknown>): TraceContext {
  // Priority 1: W3C traceparent header
  const traceparent = getHeader(headers, 'traceparent');
  if (traceparent) {
    const parsed = parseTraceparent(traceparent);
    if (parsed) return parsed;
  }

  // Priority 2: x-frontmcp-trace-id custom header
  const customTraceId = getHeader(headers, 'x-frontmcp-trace-id');
  if (customTraceId && isValidTraceId(customTraceId)) {
    const parentId = generateParentId();
    return {
      traceId: customTraceId.toLowerCase(),
      parentId,
      traceFlags: 0x01,
      raw: `00-${customTraceId.toLowerCase()}-${parentId}-01`,
    };
  }

  // Priority 3: Generate new trace context
  return generateTraceContext();
}

/**
 * Parse W3C traceparent header.
 *
 * Format: version-traceId-parentId-traceFlags
 * Example: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
 *
 * @param value - traceparent header value
 * @returns Parsed TraceContext or null if invalid
 */
function parseTraceparent(value: string): TraceContext | null {
  const parts = value.split('-');
  if (parts.length !== 4) return null;

  const [version, traceId, parentId, flags] = parts;

  // Validate version (must be 00 for current spec)
  if (version !== '00') return null;

  // Validate trace-id (32 hex chars, not all zeros)
  if (!isValidTraceId(traceId)) return null;

  // Validate parent-id (16 hex chars, not all zeros)
  if (!isValidParentId(parentId)) return null;

  // Parse trace-flags
  const traceFlags = parseInt(flags, 16);
  if (isNaN(traceFlags)) return null;

  return {
    traceId: traceId.toLowerCase(),
    parentId: parentId.toLowerCase(),
    traceFlags,
    raw: value,
  };
}

/**
 * Validate a trace ID according to W3C spec.
 * Must be 32 lowercase hex characters, not all zeros.
 */
function isValidTraceId(id: string): boolean {
  return /^[a-f0-9]{32}$/i.test(id) && id !== '00000000000000000000000000000000';
}

/**
 * Validate a parent ID according to W3C spec.
 * Must be 16 lowercase hex characters, not all zeros.
 */
function isValidParentId(id: string): boolean {
  return /^[a-f0-9]{16}$/i.test(id) && id !== '0000000000000000';
}

/**
 * Generate a new parent ID (16 hex chars).
 */
function generateParentId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

/**
 * Generate a new trace context with random IDs.
 */
export function generateTraceContext(): TraceContext {
  const traceId = randomUUID().replace(/-/g, '');
  const parentId = generateParentId();
  return {
    traceId,
    parentId,
    traceFlags: 0x01, // sampled
    raw: `00-${traceId}-${parentId}-01`,
  };
}

/**
 * Get a header value from headers object (case-insensitive).
 */
function getHeader(headers: Record<string, unknown>, name: string): string | undefined {
  // Try exact match first
  const value = headers[name];
  if (typeof value === 'string') return value;

  // Try lowercase
  const lowerValue = headers[name.toLowerCase()];
  if (typeof lowerValue === 'string') return lowerValue;

  return undefined;
}

/**
 * Create a child span context from a parent context.
 * Generates a new parentId while preserving the traceId.
 */
export function createChildSpanContext(parent: TraceContext): TraceContext {
  const newParentId = generateParentId();
  return {
    traceId: parent.traceId,
    parentId: newParentId,
    traceFlags: parent.traceFlags,
    raw: `00-${parent.traceId}-${newParentId}-${parent.traceFlags.toString(16).padStart(2, '0')}`,
  };
}
