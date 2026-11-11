import type { AuthoritiesMetadata } from '@frontmcp/auth';

import { normalizeScopeBase, type FrontMcpLogger, type ScopeEntry } from '../../common';
import { EventPublishEndpointError } from '../../errors';
import { matchRoutePath } from '../../flows/flow.http-path';
import { assertEntryAuthorities } from '../../front-mcp/authorities-rules.check';
import { servedHealthPaths } from '../../health/health.routes';
import {
  assertNotReserved,
  computeReservedPaths,
  ReservedRouteCollisionError,
} from '../../server/custom-routes.helper';
import { WorkflowWebhookReplayGuard } from '../../workflow/trigger/workflow-webhook.signature';
import type EventRegistry from '../event.registry';
import EventPublishHttpFlow from '../flows/event-publish-http.flow';
import { openEventStorage } from '../subscription/event-subscription-store.factory';
import { EventPublishIdempotency } from './event-publish-idempotency';

/** The HTTP publish endpoint a server serves: where, how it knows its callers, and what it already published. */
export interface EventPublishEndpoint {
  /** The path requests are answered on, with the scope's route base. */
  path: string;
  /** Requests are signed with it. Without it, a caller presents the bearer credentials of the MCP endpoint. */
  secret?: string;
  /** The rule a bearer caller must satisfy, with the request body as its input. */
  authorities?: AuthoritiesMetadata;
  /** The signatures accepted within their window: a signed request is taken once. */
  replays: WorkflowWebhookReplayGuard;
  idempotency: EventPublishIdempotency;
}

export interface EnablePublishEndpointArgs {
  scope: ScopeEntry;
  eventRegistry: EventRegistry;
  /** Whether the server's auth names its callers; a public server cannot tell them apart. */
  identifiesCallers: boolean;
  /** The key prefix of the server's event records, for a storage this endpoint opens itself. */
  keyPrefix: string;
  logger: FrontMcpLogger;
}

/** Refuse a path FrontMCP serves itself, and one another route of the scope answers for `POST`. */
function assertPathFree(scope: ScopeEntry, path: string): void {
  const reserved = computeReservedPaths(scope.entryPath, scope.routeBase, servedHealthPaths(scope.metadata.health));
  try {
    assertNotReserved('POST', path, reserved);
  } catch (error) {
    if (!(error instanceof ReservedRouteCollisionError)) throw error;
    throw new EventPublishEndpointError(
      `events.publishEndpoint.path "${path}" is on the reserved FrontMCP path "${error.reserved}": choose another path`,
    );
  }
  const routes = [...(scope.httpRouteTable?.routes ?? []), ...(scope.metadata.http?.routes ?? [])];
  const taken = routes.find(
    (route) => route.method.toUpperCase() === 'POST' && matchRoutePath(route.path, path) !== undefined,
  );
  if (taken) {
    throw new EventPublishEndpointError(
      `events.publishEndpoint.path "${path}" is already served by the route POST ${taken.path}: choose another path`,
    );
  }
}

/** Serve the HTTP publish endpoint of a scope; the server does not start when it could not tell who publishes. */
export async function enablePublishEndpoint(args: EnablePublishEndpointArgs): Promise<void> {
  const { scope, eventRegistry, identifiesCallers, keyPrefix, logger } = args;
  const { secret, authorities, path: configuredPath } = eventRegistry.config.publishEndpoint;
  const { store: storeConfig } = eventRegistry.config;

  if (!secret && !identifiesCallers) {
    throw new EventPublishEndpointError(
      'the server runs in public auth mode, so nothing tells who publishes. Set events.publishEndpoint.secret ' +
        '(at least 32 characters) for signed requests, or configure an auth mode that signs callers in.',
    );
  }
  if (authorities !== undefined) {
    assertEntryAuthorities(scope.authoritiesEngine, scope.authoritiesContextBuilder, [
      { label: 'events.publishEndpoint', authorities },
    ]);
  }
  const path = `${normalizeScopeBase(scope.routeBase)}${configuredPath}`;
  assertPathFree(scope, path);

  let storage = eventRegistry.storage;
  if (!storage) {
    const ownStorage = await openEventStorage({ redis: storeConfig?.redis, sqlite: storeConfig?.sqlite, keyPrefix });
    scope.onDispose(() => ownStorage.disconnect());
    storage = ownStorage;
  }

  eventRegistry.publishEndpoint = {
    path,
    secret,
    authorities,
    replays: new WorkflowWebhookReplayGuard(),
    idempotency: new EventPublishIdempotency(storage, scope.id),
  };
  await scope.registryFlows(EventPublishHttpFlow);
  logger.info(`Events can be published over HTTP: POST ${path} (${secret ? 'signed requests' : 'bearer callers'})`);
  if (!secret && authorities === undefined) {
    logger.warn(
      `POST ${path} lets every signed-in caller publish every event. Set events.publishEndpoint.authorities to ` +
        'name who may publish.',
    );
  }
}
