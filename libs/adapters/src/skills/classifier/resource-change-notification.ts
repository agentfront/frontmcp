// file: libs/adapters/src/skills/classifier/resource-change-notification.ts
//
// Pure function that turns a successful tool call into the appropriate MCP
// resource-change notification — `notifications/resources/updated` for
// single-resource mutations or `notifications/resources/list_changed` for
// collection mutations. Returns `null` when the operation has no `emit`
// in its classification, or when the URI template has unresolved
// placeholders.
//
// The dispatcher (which hooks `tools/call` success in whichever location
// fits best — openapi adapter, transport flow, or a generic post-call hook)
// pulls a `ClassifiedOperation` from the `ClassificationRegistry` keyed by
// tool name, then calls this function to build the notification payload to
// forward to the SDK's notification machinery.

import type { ClassifiedOperation } from './openapi-classify';
import { renderResourceUri } from './render-resource-uri';

/**
 * MCP `notifications/resources/updated` shape — JSON-RPC notification with
 * the affected resource URI in params.
 */
export interface ResourceUpdatedNotification {
  method: 'notifications/resources/updated';
  params: { uri: string };
}

/**
 * MCP `notifications/resources/list_changed` shape. The spec defines it as
 * carrying no params; we don't synthesize extras so subscribers see the
 * canonical event.
 */
export interface ResourcesListChangedNotification {
  method: 'notifications/resources/list_changed';
  params?: Record<string, never>;
}

export type ResourceChangeNotification = ResourceUpdatedNotification | ResourcesListChangedNotification;

/**
 * Reason `buildResourceChangeNotification` returned `null`. Surfaced so the
 * dispatcher can log + observe at the audit layer.
 */
export type SuppressedReason =
  | 'no-emit' // classification has no `emit` field — operation doesn't affect a resource
  | 'unresolved-template'; // template has `{name}` placeholders unmatched by call args

export interface BuildNotificationResult {
  notification: ResourceChangeNotification | null;
  reason?: SuppressedReason;
  /** Names of placeholders that could not be resolved, if any. */
  missing?: string[];
}

/**
 * Build the resource-change notification for a successful tool call.
 *
 * @param classification The classified operation produced by `classifyOperations`.
 * @param args           The arguments the tool was invoked with (used to
 *                       resolve URI template placeholders).
 */
export function buildResourceChangeNotification(
  classification: Pick<ClassifiedOperation, 'emit'>,
  args: unknown,
): BuildNotificationResult {
  const emit = classification.emit;
  if (!emit) return { notification: null, reason: 'no-emit' };

  if (emit.kind === 'listChanged') {
    // `list_changed` is collection-scoped but carries no URI in the MCP
    // spec. We still validate the template (so misconfigurations surface
    // at build time, not silently), but emit the canonical event.
    const rendered = renderResourceUri(emit.resourceUriTemplate, args);
    if (!rendered.ok) {
      return { notification: null, reason: 'unresolved-template', missing: rendered.missing };
    }
    return { notification: { method: 'notifications/resources/list_changed' } };
  }

  // kind === 'updated' — single-resource notification carries the URI.
  const rendered = renderResourceUri(emit.resourceUriTemplate, args);
  if (!rendered.ok) {
    return { notification: null, reason: 'unresolved-template', missing: rendered.missing };
  }
  return {
    notification: {
      method: 'notifications/resources/updated',
      params: { uri: rendered.uri },
    },
  };
}
