/**
 * Runtime tools - tools added to a running server by code outside it (a React component, a page
 * script). Each one is a regular FUNCTION tool of one of the server's apps, registered in that app's
 * ToolRegistry: the scope adopts it like the app's own tools, so `tools/list` lists it, the
 * `tools:call-tool` flow runs it with the app's hooks (plugins, authorities, quota, `availableWhen`),
 * and the registry change reaches clients as `notifications/tools/list_changed`.
 */

import { type Token } from '@frontmcp/di';
import { ToolSchema } from '@frontmcp/protocol';
import { awaitOutsideRequest } from '@frontmcp/utils';

import {
  frontMcpToolMetadataSchema,
  ToolKind,
  type AppEntry,
  type ToolFunctionTokenRecord,
  type ToolMetadata,
} from '../common';
import { EntryValidationError, InternalMcpError, ToolNameConflictError } from '../errors';
import type ProviderRegistry from '../provider/provider.registry';
import { type Scope } from '../scope/scope.instance';
import { ToolInstance } from '../tool/tool.instance';
import { type RuntimeToolDefinition } from './direct.types';

/** The call-tool flow accepts tool names of 1-64 characters. */
const MAX_TOOL_NAME_LENGTH = 64;

/**
 * What `tools/list` requires of a listed tool's input schema: an object schema. Checked when the tool
 * is registered, since one tool listing a schema that fails it would fail every `tools/list`.
 */
const listedInputSchema = ToolSchema.shape.inputSchema;

/** What the tool context hands a FUNCTION tool's `provide`. */
interface RuntimeToolCallContext {
  readonly signal?: AbortSignal;
}

/** One line per problem zod found, `path: message`. */
function describeIssues(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): string {
  return issues.map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`).join('; ');
}

/**
 * Check the parts of `definition` that end up in `tools/list` and in `availableWhen` filtering. It
 * comes from plain JavaScript, past the type checker, and unlike a decorated tool's metadata it is not
 * parsed anywhere else: a malformed one would make every listing fail instead of this registration.
 */
function validateRuntimeToolDefinition(definition: RuntimeToolDefinition): void {
  const { name, title, description, annotations, availableWhen, inputSchema } = definition;
  const metadata = frontMcpToolMetadataSchema.safeParse({
    name,
    title,
    description,
    inputSchema: {},
    annotations,
    availableWhen,
  });
  if (!metadata.success) {
    throw new EntryValidationError('Tool', `runtime tool "${name}": ${describeIssues(metadata.error.issues)}`);
  }
  // No schema (undefined, or null from plain JavaScript) lists as an empty object schema
  if (inputSchema !== undefined && inputSchema !== null) {
    const listed = listedInputSchema.safeParse(inputSchema);
    if (!listed.success) {
      throw new EntryValidationError(
        'Tool',
        `runtime tool "${name}" input schema must be an object schema: ${describeIssues(listed.error.issues)}`,
      );
    }
  }
}

/** Refuse to add a tool to a scope that is being (or has been) disposed. */
function assertScopeNotDisposed(scope: Scope, name: string): void {
  if (scope.isDisposed) {
    throw new InternalMcpError(`runtime tool "${name}" was not registered: the server has been disposed`);
  }
}

/**
 * The local app a runtime tool joins: the one `appId` names, or the server's only local app (a
 * `create()` server has exactly one).
 */
function appForRuntimeTool(scope: Scope, name: string, appId: string | undefined): AppEntry {
  const localApps = scope.apps.getApps().filter((app) => !app.isRemote);
  if (appId !== undefined) {
    const app = localApps.find((candidate) => candidate.id === appId);
    if (!app) throw new EntryValidationError('Tool', `runtime tool "${name}" names app "${appId}", which is not here`);
    return app;
  }
  if (localApps.length === 1) return localApps[0];
  throw new EntryValidationError(
    'Tool',
    localApps.length === 0
      ? `runtime tool "${name}" has no local app to join`
      : `runtime tool "${name}" must name its app (one of: ${localApps.map((app) => app.id).join(', ')})`,
  );
}

/**
 * Register `definition` as a tool of one of `scope`'s apps.
 *
 * @returns A function that unregisters the tool (idempotent)
 */
export async function registerRuntimeTool(scope: Scope, definition: RuntimeToolDefinition): Promise<() => void> {
  const { name } = definition;
  if (typeof name !== 'string' || name.length === 0 || name.length > MAX_TOOL_NAME_LENGTH) {
    throw new EntryValidationError('Tool', `runtime tool name must be 1-${MAX_TOOL_NAME_LENGTH} characters`);
  }
  if (typeof definition.execute !== 'function') {
    throw new EntryValidationError('Tool', `runtime tool "${name}" has no execute function`);
  }
  validateRuntimeToolDefinition(definition);
  assertScopeNotDisposed(scope, name);
  const app = appForRuntimeTool(scope, name, definition.app);
  if (scope.tools.listAllInstances().some((tool) => tool.name === name)) {
    throw new ToolNameConflictError(name);
  }

  // The page's code runs without the request's turn, so it can call the server (or wait on the
  // network) without stalling every other request of a runtime that has no AsyncContext.
  const provide = (args: Record<string, unknown>, ctx: RuntimeToolCallContext) =>
    awaitOutsideRequest(
      Promise.resolve().then(() =>
        definition.execute(args ?? {}, { signal: ctx?.signal ?? new AbortController().signal }),
      ),
    );

  const metadata: ToolMetadata & { rawInputSchema: Record<string, unknown> } = {
    name,
    title: definition.title,
    description: definition.description,
    inputSchema: {},
    annotations: definition.annotations,
    availableWhen: definition.availableWhen,
    // Listed as given; arguments pass through unvalidated (see RuntimeToolDefinition.inputSchema)
    rawInputSchema: definition.inputSchema ?? { type: 'object', properties: {} },
  };
  const record: ToolFunctionTokenRecord = { kind: ToolKind.FUNCTION, provide, metadata };

  const appTools = app.tools;
  const instance = new ToolInstance(record, app.providers as unknown as ProviderRegistry, appTools.owner);
  await instance.ready;

  // Checked again: the server may have been disposed, or another registration may have taken the
  // name, while this one initialized
  assertScopeNotDisposed(scope, name);
  if (scope.tools.listAllInstances().some((tool) => tool.name === name)) {
    throw new ToolNameConflictError(name);
  }
  appTools.registerToolInstance(instance);

  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    // For a FUNCTION tool the provide function is the registry token
    appTools.unregisterToolInstance(provide as unknown as Token);
  };
}
