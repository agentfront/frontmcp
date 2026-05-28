// file: libs/adapters/src/skills/__tests__/openapi-classify.spec.ts

import {
  applyClassificationOverrides,
  classifyOne,
  classifyOperations,
  type ClassifiedOperation,
  type InputOperation,
} from '../classifier/openapi-classify';

const SPEC = 'acme';

function uri(path: string): string {
  return `mcp+op://${SPEC}/${path.startsWith('/') ? path.slice(1) : path}`;
}

function findOp(classified: ClassifiedOperation[], operationId: string): ClassifiedOperation {
  const found = classified.find((c) => c.operationId === operationId);
  if (!found) throw new Error(`expected to find ${operationId} in classified ops`);
  return found;
}

describe('classifyOperations — read operations', () => {
  it('classifies GET on a path-parameter path as both (resource template + tool)', () => {
    const ops: InputOperation[] = [{ operationId: 'getUserById', method: 'GET', path: '/users/{id}' }];
    const classified = classifyOperations(SPEC, ops);

    expect(classified).toHaveLength(1);
    expect(classified[0]).toMatchObject({
      operationId: 'getUserById',
      method: 'GET',
      path: '/users/{id}',
      specId: SPEC,
      expose: 'both',
      resourceUriTemplate: uri('/users/{id}'),
    });
    expect(classified[0].emit).toBeUndefined();
  });

  it('classifies GET on a collection path as resource (no tool)', () => {
    const ops: InputOperation[] = [{ operationId: 'listUsers', method: 'GET', path: '/users' }];
    const classified = classifyOperations(SPEC, ops);

    expect(classified[0]).toMatchObject({
      expose: 'resource',
      resourceUriTemplate: uri('/users'),
    });
    expect(classified[0].emit).toBeUndefined();
  });

  it('treats a path whose terminal segment is static as a collection (no terminal param)', () => {
    const ops: InputOperation[] = [{ operationId: 'listPosts', method: 'GET', path: '/users/{id}/posts' }];
    const classified = classifyOperations(SPEC, ops);
    expect(classified[0].expose).toBe('resource');
  });
});

describe('classifyOperations — POST', () => {
  it('POST on a collection with matching GET → tool + emit listChanged on self', () => {
    const ops: InputOperation[] = [
      { operationId: 'listUsers', method: 'GET', path: '/users' },
      { operationId: 'createUser', method: 'POST', path: '/users' },
    ];
    const classified = classifyOperations(SPEC, ops);
    const create = findOp(classified, 'createUser');

    expect(create.expose).toBe('tool');
    expect(create.emit).toEqual({
      kind: 'listChanged',
      pathTemplate: '/users',
      resourceUriTemplate: uri('/users'),
    });
  });

  it('POST on a singular path with matching GET → tool + emit updated on self', () => {
    const ops: InputOperation[] = [
      { operationId: 'getUserById', method: 'GET', path: '/users/{id}' },
      { operationId: 'replaceUser', method: 'POST', path: '/users/{id}' },
    ];
    const classified = classifyOperations(SPEC, ops);
    const replace = findOp(classified, 'replaceUser');

    expect(replace.expose).toBe('tool');
    expect(replace.emit).toEqual({
      kind: 'updated',
      pathTemplate: '/users/{id}',
      resourceUriTemplate: uri('/users/{id}'),
    });
  });

  it('POST on an action path (no matching GET) emits updated on the parent resource', () => {
    const ops: InputOperation[] = [
      { operationId: 'getUserById', method: 'GET', path: '/users/{id}' },
      { operationId: 'resetPassword', method: 'POST', path: '/users/{id}/reset-password' },
    ];
    const classified = classifyOperations(SPEC, ops);
    const reset = findOp(classified, 'resetPassword');

    expect(reset.expose).toBe('tool');
    expect(reset.emit).toEqual({
      kind: 'updated',
      pathTemplate: '/users/{id}',
      resourceUriTemplate: uri('/users/{id}'),
    });
  });

  it('POST with no matching GET on self or parent emits nothing', () => {
    const ops: InputOperation[] = [{ operationId: 'sendNotification', method: 'POST', path: '/notify' }];
    const classified = classifyOperations(SPEC, ops);
    const op = findOp(classified, 'sendNotification');

    expect(op.expose).toBe('tool');
    expect(op.emit).toBeUndefined();
  });
});

describe('classifyOperations — PUT / PATCH', () => {
  it('PUT with matching GET emits updated on self', () => {
    const ops: InputOperation[] = [
      { operationId: 'getUserById', method: 'GET', path: '/users/{id}' },
      { operationId: 'updateUser', method: 'PUT', path: '/users/{id}' },
    ];
    const classified = classifyOperations(SPEC, ops);
    const update = findOp(classified, 'updateUser');

    expect(update.emit).toEqual({
      kind: 'updated',
      pathTemplate: '/users/{id}',
      resourceUriTemplate: uri('/users/{id}'),
    });
  });

  it('PATCH with matching GET emits updated on self', () => {
    const ops: InputOperation[] = [
      { operationId: 'getUserById', method: 'GET', path: '/users/{id}' },
      { operationId: 'patchUser', method: 'PATCH', path: '/users/{id}' },
    ];
    const classified = classifyOperations(SPEC, ops);
    expect(findOp(classified, 'patchUser').emit?.kind).toBe('updated');
  });

  it('PUT on a path without matching GET falls back to parent emit', () => {
    const ops: InputOperation[] = [
      { operationId: 'getUserById', method: 'GET', path: '/users/{id}' },
      { operationId: 'replaceAddress', method: 'PUT', path: '/users/{id}/address' },
    ];
    const classified = classifyOperations(SPEC, ops);
    const replaceAddr = findOp(classified, 'replaceAddress');

    expect(replaceAddr.emit).toEqual({
      kind: 'updated',
      pathTemplate: '/users/{id}',
      resourceUriTemplate: uri('/users/{id}'),
    });
  });
});

describe('classifyOperations — DELETE', () => {
  it('DELETE on a singular path emits listChanged on parent collection', () => {
    const ops: InputOperation[] = [
      { operationId: 'listUsers', method: 'GET', path: '/users' },
      { operationId: 'getUserById', method: 'GET', path: '/users/{id}' },
      { operationId: 'deleteUser', method: 'DELETE', path: '/users/{id}' },
    ];
    const classified = classifyOperations(SPEC, ops);
    const del = findOp(classified, 'deleteUser');

    expect(del.emit).toEqual({
      kind: 'listChanged',
      pathTemplate: '/users',
      resourceUriTemplate: uri('/users'),
    });
  });

  it('DELETE on a collection path emits listChanged on self', () => {
    const ops: InputOperation[] = [
      { operationId: 'listUsers', method: 'GET', path: '/users' },
      { operationId: 'deleteAllUsers', method: 'DELETE', path: '/users' },
    ];
    const classified = classifyOperations(SPEC, ops);
    expect(findOp(classified, 'deleteAllUsers').emit).toEqual({
      kind: 'listChanged',
      pathTemplate: '/users',
      resourceUriTemplate: uri('/users'),
    });
  });

  it('DELETE with no GET on parent emits nothing', () => {
    const ops: InputOperation[] = [{ operationId: 'deleteAddress', method: 'DELETE', path: '/users/{id}/address' }];
    const classified = classifyOperations(SPEC, ops);
    expect(findOp(classified, 'deleteAddress').emit).toBeUndefined();
  });
});

describe('classifyOperations — input handling', () => {
  it('returns an empty list when ops is empty', () => {
    expect(classifyOperations(SPEC, [])).toEqual([]);
  });

  it('throws on a missing or empty specId', () => {
    expect(() => classifyOperations('', [])).toThrow(/specId is required/);
  });

  it('normalises method case', () => {
    const ops: InputOperation[] = [{ operationId: 'getUserById', method: 'get', path: '/users/{id}' }];
    const classified = classifyOperations(SPEC, ops);
    expect(classified[0].method).toBe('GET');
    expect(classified[0].expose).toBe('both');
  });

  it('passes unknown HTTP methods through as tools with no emit', () => {
    const ops: InputOperation[] = [{ operationId: 'queryDb', method: 'QUERY', path: '/db' }];
    const classified = classifyOperations(SPEC, ops);
    expect(classified[0].expose).toBe('tool');
    expect(classified[0].emit).toBeUndefined();
  });

  it('classifyOne is reusable across calls with the same pathsWithGet set', () => {
    // Both `/users` (collection) and `/users/{id}` (singular) are known
    // resources, so DELETE's listChanged notification has a valid parent.
    const pathsWithGet = new Set(['/users', '/users/{id}']);
    const a = classifyOne(SPEC, { operationId: 'updateUser', method: 'PUT', path: '/users/{id}' }, pathsWithGet);
    const b = classifyOne(SPEC, { operationId: 'deleteUser', method: 'DELETE', path: '/users/{id}' }, pathsWithGet);

    expect(a.emit?.kind).toBe('updated');
    expect(b.emit?.kind).toBe('listChanged');
  });
});

describe('applyClassificationOverrides', () => {
  function buildOps(): ClassifiedOperation[] {
    return classifyOperations(SPEC, [
      { operationId: 'getUserById', method: 'GET', path: '/users/{id}' },
      { operationId: 'updateUser', method: 'PUT', path: '/users/{id}' },
      { operationId: 'resetPassword', method: 'POST', path: '/users/{id}/reset-password' },
    ]);
  }

  it('returns a copy of the input when there are no rules', () => {
    const before = buildOps();
    const after = applyClassificationOverrides(before, []);
    expect(after).toEqual(before);
    expect(after).not.toBe(before); // a fresh array
  });

  it('overrides expose for matching method+path', () => {
    const ops = buildOps();
    const after = applyClassificationOverrides(ops, [{ match: 'GET /users/{id}', expose: 'tool' }]);
    expect(findOp(after, 'getUserById').expose).toBe('tool');
  });

  it('overrides emit to none', () => {
    const ops = buildOps();
    const after = applyClassificationOverrides(ops, [{ match: 'PUT /users/{id}', emits: 'none' }]);
    expect(findOp(after, 'updateUser').emit).toBeUndefined();
  });

  it('overrides emit to parent', () => {
    const ops = buildOps();
    const after = applyClassificationOverrides(ops, [{ match: 'PUT /users/{id}', emits: 'parent' }]);
    expect(findOp(after, 'updateUser').emit).toEqual({
      kind: 'updated',
      pathTemplate: '/users',
      resourceUriTemplate: uri('/users'),
    });
  });

  it('overrides emit to self', () => {
    const ops = buildOps();
    const after = applyClassificationOverrides(ops, [{ match: 'POST /users/{id}/reset-password', emits: 'self' }]);
    expect(findOp(after, 'resetPassword').emit).toEqual({
      kind: 'updated',
      pathTemplate: '/users/{id}/reset-password',
      resourceUriTemplate: uri('/users/{id}/reset-password'),
    });
  });

  it('supports * (single-segment) and ** (multi-segment) globs', () => {
    const ops = buildOps();
    const after = applyClassificationOverrides(ops, [
      { match: 'POST */reset-password', emits: 'none' }, // shouldn't match (path has 2 segments before)
      { match: 'POST **/reset-password', emits: 'none' }, // should match
    ]);
    expect(findOp(after, 'resetPassword').emit).toBeUndefined();
  });

  it('supports `*` method to match any method', () => {
    const ops = buildOps();
    const after = applyClassificationOverrides(ops, [{ match: '* /users/{id}', expose: 'tool' }]);
    expect(findOp(after, 'getUserById').expose).toBe('tool');
    expect(findOp(after, 'updateUser').expose).toBe('tool'); // was already tool
  });

  it('first matching rule wins; later rules do not stack', () => {
    const ops = buildOps();
    const after = applyClassificationOverrides(ops, [
      { match: 'PUT /users/{id}', emits: 'none' },
      { match: 'PUT /users/{id}', emits: 'self' }, // ignored
    ]);
    expect(findOp(after, 'updateUser').emit).toBeUndefined();
  });

  it('emits:self on a DELETE override defaults kind to listChanged, not updated', () => {
    // Regression: previously the override defaulted `kind` to 'updated' which
    // would silently fire `notifications/resources/updated` on the
    // just-deleted URI. DELETE must default to `listChanged` since the
    // mutation rearranges the collection, not the (now-gone) resource.
    const ops = classifyOperations(SPEC, [{ operationId: 'deleteOrphan', method: 'DELETE', path: '/orphan' }]);
    expect(ops[0].emit).toBeUndefined(); // no parent + no matching GET => no original emit

    const after = applyClassificationOverrides(ops, [{ match: 'DELETE /orphan', emits: 'self' }]);

    expect(after[0].emit).toEqual({
      kind: 'listChanged',
      pathTemplate: '/orphan',
      resourceUriTemplate: uri('/orphan'),
    });
  });

  it('emits:parent on a DELETE override also defaults to listChanged', () => {
    // Same regression as above but for the parent branch — a DELETE override
    // pointing at a parent path should fire listChanged on the parent.
    const ops = classifyOperations(SPEC, [{ operationId: 'deleteSomething', method: 'DELETE', path: '/widgets/{id}' }]);
    // No matching GET on /widgets, so the classifier left no original emit.
    expect(ops[0].emit).toBeUndefined();

    const after = applyClassificationOverrides(ops, [{ match: 'DELETE /widgets/{id}', emits: 'parent' }]);

    expect(after[0].emit).toEqual({
      kind: 'listChanged',
      pathTemplate: '/widgets',
      resourceUriTemplate: uri('/widgets'),
    });
  });

  it('emits override preserves the classifier-derived kind when present', () => {
    // When the classifier already set kind (e.g. PUT -> updated), an
    // `emits: 'self'` override must NOT clobber that to the method default.
    const ops = classifyOperations(SPEC, [
      { operationId: 'getUserById', method: 'GET', path: '/users/{id}' },
      { operationId: 'updateUser', method: 'PUT', path: '/users/{id}' },
    ]);
    const after = applyClassificationOverrides(ops, [{ match: 'PUT /users/{id}', emits: 'self' }]);

    expect(findOp(after, 'updateUser').emit?.kind).toBe('updated');
  });

  it('ignores malformed rule strings', () => {
    const ops = buildOps();
    expect(() =>
      applyClassificationOverrides(ops, [
        { match: '', emits: 'self' },
        { match: 'GETNOSEP', emits: 'self' },
        { match: 'GET ', emits: 'self' },
      ]),
    ).not.toThrow();
  });
});
