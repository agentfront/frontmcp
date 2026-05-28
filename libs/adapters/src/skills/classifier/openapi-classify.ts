// file: libs/adapters/src/skills/classifier/openapi-classify.ts
//
// OpenAPI -> MCP classifier (build-time, pure function).
//
// Given a list of OpenAPI operations belonging to a single spec, produce one
// `ClassifiedOperation` per input operation describing:
//
//   - which MCP primitive it surfaces as (tool, resource, both)
//   - what `notifications/*` event, if any, it emits on a successful call
//   - the URI template (for resources / for the emit target)
//
// The classification follows HTTP semantics with no per-spec assumptions:
//
//   GET path-param      -> expose: 'both',     emit: none
//   GET no-path-param   -> expose: 'resource', emit: none      (collection)
//   POST collection     -> expose: 'tool',     emit: listChanged on self path
//   POST singular       -> expose: 'tool',     emit: updated on self path        (upsert)
//   POST action endpt   -> expose: 'tool',     emit: updated on parent path      (parent has GET)
//   PUT/PATCH same path -> expose: 'tool',     emit: updated on self path
//   PUT/PATCH action    -> expose: 'tool',     emit: updated on parent path
//   DELETE singular     -> expose: 'tool',     emit: listChanged on parent path
//   DELETE collection   -> expose: 'tool',     emit: listChanged on self path
//
// "matching GET" means another operation in the same spec has method=GET and
// the same `path` template. If no matching GET exists AND the parent path
// has no matching GET either, the mutation's `emit` is undefined — the
// runtime won't surface a notification because nothing in the spec
// advertises a resource view to invalidate.
//
// Classification rule overrides from the deploy manifest's
// `classification.rules` are applied via `applyClassificationOverrides`,
// keeping this core pure.

/**
 * HTTP methods the classifier recognises. Anything else (HEAD, OPTIONS,
 * TRACE) is passed through with `expose: 'tool'` and no emit.
 */
export type ClassifiableHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A single OpenAPI operation as fed to the classifier. */
export interface InputOperation {
  operationId: string;
  method: string; // case-insensitive; normalised internally
  path: string; // path template, e.g. /users/{id}
}

export type ExposeKind = 'tool' | 'resource' | 'both';

export interface MutationEmit {
  /** Which MCP notification fires on a successful call. */
  kind: 'updated' | 'listChanged';
  /** Path template the emit URI is rendered from (e.g. `/users/{id}`). */
  pathTemplate: string;
  /** Fully-rendered URI template (e.g. `mcp+op://acme/users/{id}`). */
  resourceUriTemplate: string;
}

export interface ClassifiedOperation {
  operationId: string;
  method: string; // normalised upper-case
  path: string;
  specId: string;
  expose: ExposeKind;
  /** Present only when the path itself is reachable as a resource. */
  resourceUriTemplate?: string;
  /** Present only for mutations that should fire a notification. */
  emit?: MutationEmit;
}

/**
 * Classify every operation in a single spec.
 *
 * @param specId - The spec identifier (e.g. `acme-api`). Used to build URIs.
 * @param ops   - All operations in the spec; the classifier scans the full
 *                list to decide "matching GET" for each path.
 */
export function classifyOperations(specId: string, ops: ReadonlyArray<InputOperation>): ClassifiedOperation[] {
  if (!specId || specId.length === 0) {
    throw new Error('classifyOperations: specId is required');
  }
  if (!Array.isArray(ops)) return [];

  // Build a set of paths that have a GET operation. Lookup is O(1) per op.
  const pathsWithGet = new Set<string>();
  for (const op of ops) {
    if (op && typeof op.path === 'string' && typeof op.method === 'string' && op.method.toUpperCase() === 'GET') {
      pathsWithGet.add(op.path);
    }
  }

  return ops.map((op) => classifyOne(specId, op, pathsWithGet));
}

/**
 * Classify a single operation in the context of its spec's GET path set.
 *
 * Exposed so callers that already have a pre-built `pathsWithGet` can reuse
 * it instead of recomputing per call.
 */
export function classifyOne(
  specId: string,
  op: InputOperation,
  pathsWithGet: ReadonlySet<string>,
): ClassifiedOperation {
  const method = normaliseMethod(op.method);
  const path = op.path;
  const hasTerminalParam = pathHasTerminalParam(path);
  const parent = parentPath(path);
  const thisIsResource = pathsWithGet.has(path);
  const parentIsResource = parent !== null && pathsWithGet.has(parent);

  const selfUri = pathToResourceUri(specId, path);
  const parentUri = parent !== null ? pathToResourceUri(specId, parent) : null;

  // --- READ -------------------------------------------------------------
  if (method === 'GET') {
    if (hasTerminalParam) {
      return {
        operationId: op.operationId,
        method,
        path,
        specId,
        expose: 'both',
        resourceUriTemplate: selfUri,
      };
    }
    return {
      operationId: op.operationId,
      method,
      path,
      specId,
      expose: 'resource',
      resourceUriTemplate: selfUri,
    };
  }

  // --- MUTATIONS --------------------------------------------------------
  const base: Omit<ClassifiedOperation, 'emit'> = {
    operationId: op.operationId,
    method,
    path,
    specId,
    expose: 'tool',
    // `resourceUriTemplate` left undefined for mutations — the emit target
    // is the authoritative thing to look at.
  };

  if (method === 'POST') {
    // POST on a collection (no terminal `{...}`) where the collection has a
    // GET — creates a new item; the collection list changes.
    if (thisIsResource && !hasTerminalParam) {
      return { ...base, emit: { kind: 'listChanged', pathTemplate: path, resourceUriTemplate: selfUri } };
    }
    // POST on a singular path with matching GET — upsert/replace.
    if (thisIsResource && hasTerminalParam) {
      return { ...base, emit: { kind: 'updated', pathTemplate: path, resourceUriTemplate: selfUri } };
    }
    // Action endpoint (no GET on this exact path). If parent is a real
    // resource, the action's side-effects show up there.
    if (parentIsResource && parentUri !== null && parent !== null) {
      return { ...base, emit: { kind: 'updated', pathTemplate: parent, resourceUriTemplate: parentUri } };
    }
    return base; // No emit — nothing in the spec advertises a resource view.
  }

  if (method === 'PUT' || method === 'PATCH') {
    if (thisIsResource) {
      return { ...base, emit: { kind: 'updated', pathTemplate: path, resourceUriTemplate: selfUri } };
    }
    if (parentIsResource && parentUri !== null && parent !== null) {
      return { ...base, emit: { kind: 'updated', pathTemplate: parent, resourceUriTemplate: parentUri } };
    }
    return base;
  }

  if (method === 'DELETE') {
    // Singular DELETE - the parent collection lost an item.
    if (hasTerminalParam && parentIsResource && parentUri !== null && parent !== null) {
      return { ...base, emit: { kind: 'listChanged', pathTemplate: parent, resourceUriTemplate: parentUri } };
    }
    // Collection DELETE (DELETE /users) - itself is the collection.
    if (!hasTerminalParam && thisIsResource) {
      return { ...base, emit: { kind: 'listChanged', pathTemplate: path, resourceUriTemplate: selfUri } };
    }
    return base;
  }

  // HEAD, OPTIONS, TRACE, or any unknown method - safe default.
  return base;
}

// ============================================================================
// Classification overrides (deploy manifest `classification.rules`)
// ============================================================================

export interface ClassificationOverrideRule {
  /**
   * Pattern: `METHOD path-glob`. The glob uses `*` for single-segment
   * wildcards and `**` for multi-segment. Example (avoiding literal
   * star-slash in this docstring): `POST <STAR><STAR>/reset-password`.
   */
  match: string;
  /** Override the MCP surface. */
  expose?: ExposeKind;
  /** Override the emit target. `none` clears any default. */
  emits?: 'self' | 'parent' | 'none';
}

/**
 * Apply manifest overrides on top of a list of already-classified ops.
 *
 * Rules are evaluated in declaration order; the first match wins per op.
 * A rule with both `expose` and `emits` undefined is a no-op (rejected by
 * the schema upstream but tolerated here for forward-compat).
 */
export function applyClassificationOverrides(
  classified: ReadonlyArray<ClassifiedOperation>,
  rules: ReadonlyArray<ClassificationOverrideRule>,
): ClassifiedOperation[] {
  if (!Array.isArray(rules) || rules.length === 0) return classified.slice();
  const compiled = rules.map((rule) => ({ rule, matcher: compileMatcher(rule.match) }));

  return classified.map((op) => {
    for (const { rule, matcher } of compiled) {
      if (!matcher(op)) continue;
      return applyOne(op, rule);
    }
    return op;
  });
}

// ============================================================================
// Internal helpers
// ============================================================================

const KNOWN_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE']);

function normaliseMethod(m: string): string {
  const up = (m ?? '').toUpperCase();
  return KNOWN_METHODS.has(up) ? up : up;
}

/**
 * Whether the last segment of the path is a path parameter, i.e. enclosed in
 * curly braces. `/users/{id}` -> true; `/users` -> false; `/users/{id}/posts`
 * -> false (the terminal segment is the static `posts`).
 */
function pathHasTerminalParam(path: string): boolean {
  if (typeof path !== 'string' || path.length === 0) return false;
  const segments = path.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return false;
  const last = segments[segments.length - 1];
  return last.startsWith('{') && last.endsWith('}') && last.length >= 3;
}

/**
 * Strip the final path segment. Returns `null` if there's nothing to strip
 * (root, or already at top-level collection).
 *
 *   /users           -> null
 *   /users/{id}      -> /users
 *   /users/{id}/posts -> /users/{id}
 */
function parentPath(path: string): string | null {
  if (typeof path !== 'string' || path.length === 0) return null;
  const segments = path.split('/').filter((s) => s.length > 0);
  if (segments.length <= 1) return null;
  return '/' + segments.slice(0, -1).join('/');
}

/**
 * Render a path template to a `mcp+op://<spec>/<path>` URI template. Path
 * parameters survive intact (so subscribers can match the template).
 */
function pathToResourceUri(specId: string, path: string): string {
  const cleaned = path.startsWith('/') ? path.slice(1) : path;
  return `mcp+op://${specId}/${cleaned}`;
}

/**
 * Compile a `METHOD path-glob` rule to a matcher function. Glob syntax
 * supports `*` (one or more chars, no `/` allowed) and `**` (matches across
 * `/`). Method may be `*` to match any method.
 */
function compileMatcher(match: string): (op: ClassifiedOperation) => boolean {
  const trimmed = (match ?? '').trim();
  const sep = trimmed.indexOf(' ');
  if (sep <= 0 || sep === trimmed.length - 1) {
    return () => false; // malformed; ignore
  }
  const methodPattern = trimmed.slice(0, sep).toUpperCase();
  const pathPattern = trimmed.slice(sep + 1);

  const pathRe = globToRegExp(pathPattern);

  return (op: ClassifiedOperation): boolean => {
    if (methodPattern !== '*' && methodPattern !== op.method) return false;
    return pathRe.test(op.path);
  };
}

/**
 * Convert a glob to an anchored RegExp. `**` matches any character; `*`
 * matches any non-slash characters; `?` is literal.
 */
function globToRegExp(glob: string): RegExp {
  // Use placeholders so escaping doesn't eat our wildcards.
  const STAR_STAR = '\x00';
  const STAR = '\x01';
  const replaced = glob.replace(/\*\*/g, STAR_STAR).replace(/\*/g, STAR);
  const escaped = replaced.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const expanded = escaped.split(STAR_STAR).join('.*').split(STAR).join('[^/]*');
  return new RegExp(`^${expanded}$`);
}

/**
 * Pick the `MutationEmit.kind` for an override when the op had no original
 * emit to inherit from.
 *
 * Semantically: a mutation override emits `listChanged` when the op
 * "rearranges a collection" (DELETE invalidates the list; collection POST
 * adds to it) and `updated` when it mutates a single resource. We default
 * by method so an override against a DELETE doesn't silently fire
 * `notifications/resources/updated` on the just-deleted URI.
 */
function defaultEmitKindForMethod(method: string): 'updated' | 'listChanged' {
  return method === 'DELETE' ? 'listChanged' : 'updated';
}

function applyOne(op: ClassifiedOperation, rule: ClassificationOverrideRule): ClassifiedOperation {
  let next: ClassifiedOperation = { ...op };

  if (rule.expose !== undefined) {
    next = { ...next, expose: rule.expose };
  }

  if (rule.emits !== undefined) {
    if (rule.emits === 'none') {
      const { emit: _drop, ...rest } = next;
      next = rest;
    } else if (rule.emits === 'self') {
      const target = pathToResourceUri(op.specId, op.path);
      next = {
        ...next,
        emit: {
          // Preserve the classifier's original kind if it set one; otherwise
          // derive from the HTTP method so a DELETE override doesn't end up
          // emitting `updated` on its own (now-gone) URI.
          kind: next.emit?.kind ?? defaultEmitKindForMethod(op.method),
          pathTemplate: op.path,
          resourceUriTemplate: target,
        },
      };
    } else if (rule.emits === 'parent') {
      const parent = parentPath(op.path);
      if (parent !== null) {
        next = {
          ...next,
          emit: {
            kind: next.emit?.kind ?? defaultEmitKindForMethod(op.method),
            pathTemplate: parent,
            resourceUriTemplate: pathToResourceUri(op.specId, parent),
          },
        };
      } else {
        const { emit: _drop, ...rest } = next;
        next = rest;
      }
    }
  }

  return next;
}
