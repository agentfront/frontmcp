import { parseOpenApiSpec } from '../parseOpenApiSpec';

describe('parseOpenApiSpec', () => {
  // ─── Basic extraction ───────────────────────────────────────────────────

  describe('basic operation extraction', () => {
    it('extracts a single GET operation', () => {
      const spec = {
        paths: {
          '/users': {
            get: {
              operationId: 'listUsers',
              summary: 'List all users',
            },
          },
        },
      };

      const ops = parseOpenApiSpec(spec);
      expect(ops).toHaveLength(1);
      expect(ops[0]).toEqual({
        operationId: 'listUsers',
        description: 'List all users',
        method: 'GET',
        path: '/users',
        inputSchema: { type: 'object', properties: {} },
      });
    });

    it('extracts multiple methods from the same path', () => {
      const spec = {
        paths: {
          '/items': {
            get: { operationId: 'listItems', summary: 'List items' },
            post: { operationId: 'createItem', summary: 'Create item' },
            delete: { operationId: 'deleteItems', summary: 'Delete items' },
          },
        },
      };

      const ops = parseOpenApiSpec(spec);
      expect(ops).toHaveLength(3);
      expect(ops.map((o) => o.method)).toEqual(['GET', 'POST', 'DELETE']);
      expect(ops.map((o) => o.operationId)).toEqual(['listItems', 'createItem', 'deleteItems']);
    });

    it('extracts operations from multiple paths', () => {
      const spec = {
        paths: {
          '/a': { get: { operationId: 'getA', summary: 'Get A' } },
          '/b': { post: { operationId: 'postB', summary: 'Post B' } },
        },
      };

      const ops = parseOpenApiSpec(spec);
      expect(ops).toHaveLength(2);
      expect(ops[0].path).toBe('/a');
      expect(ops[1].path).toBe('/b');
    });

    it('supports all HTTP methods', () => {
      const spec = {
        paths: {
          '/all': {
            get: { operationId: 'op_get' },
            post: { operationId: 'op_post' },
            put: { operationId: 'op_put' },
            delete: { operationId: 'op_delete' },
            patch: { operationId: 'op_patch' },
            options: { operationId: 'op_options' },
            head: { operationId: 'op_head' },
          },
        },
      };

      const ops = parseOpenApiSpec(spec);
      expect(ops).toHaveLength(7);
      expect(ops.map((o) => o.method)).toEqual(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD']);
    });
  });

  // ─── operationId generation ─────────────────────────────────────────────

  describe('operationId generation', () => {
    it('uses operationId from spec when present', () => {
      const spec = {
        paths: {
          '/users': { get: { operationId: 'myCustomId' } },
        },
      };

      const ops = parseOpenApiSpec(spec);
      expect(ops[0].operationId).toBe('myCustomId');
    });

    it('generates operationId from method + path when missing', () => {
      const spec = {
        paths: {
          '/users/{id}': { get: {} },
        },
      };

      const ops = parseOpenApiSpec(spec);
      expect(ops[0].operationId).toBe('get__users__id_');
    });

    it('replaces all non-alphanumeric characters with underscores in generated operationId', () => {
      const spec = {
        paths: {
          '/api/v2/users/{userId}/posts': { post: {} },
        },
      };

      const ops = parseOpenApiSpec(spec);
      expect(ops[0].operationId).toBe('post__api_v2_users__userId__posts');
    });
  });

  // ─── description ────────────────────────────────────────────────────────

  describe('description', () => {
    it('uses summary when present', () => {
      const spec = {
        paths: {
          '/x': { get: { summary: 'My Summary', description: 'My Description' } },
        },
      };

      const ops = parseOpenApiSpec(spec);
      expect(ops[0].description).toBe('My Summary');
    });

    it('falls back to description when summary is missing', () => {
      const spec = {
        paths: {
          '/x': { get: { description: 'Fallback Description' } },
        },
      };

      const ops = parseOpenApiSpec(spec);
      expect(ops[0].description).toBe('Fallback Description');
    });

    it('generates description from method + path when both are missing', () => {
      const spec = {
        paths: {
          '/users': { get: { operationId: 'listUsers' } },
        },
      };

      const ops = parseOpenApiSpec(spec);
      expect(ops[0].description).toBe('GET /users');
    });
  });

  // ─── parameters ─────────────────────────────────────────────────────────

  describe('parameters', () => {
    it('includes parameters in inputSchema properties', () => {
      const spec = {
        paths: {
          '/users/{id}': {
            get: {
              operationId: 'getUser',
              summary: 'Get user',
              parameters: [
                { name: 'id', in: 'path', required: true, description: 'User ID', schema: { type: 'string' } },
                { name: 'fields', in: 'query', description: 'Fields to return', schema: { type: 'string' } },
              ],
            },
          },
        },
      };

      const ops = parseOpenApiSpec(spec);
      expect(ops[0].inputSchema).toEqual({
        type: 'object',
        properties: {
          id: { type: 'string', description: 'User ID' },
          fields: { type: 'string', description: 'Fields to return' },
        },
        required: ['id'],
      });
    });

    it('marks required parameters in required array', () => {
      const spec = {
        paths: {
          '/x': {
            get: {
              operationId: 'op',
              parameters: [
                { name: 'req1', in: 'path', required: true },
                { name: 'opt1', in: 'query', required: false },
                { name: 'req2', in: 'header', required: true },
                { name: 'opt2', in: 'query' },
              ],
            },
          },
        },
      };

      const ops = parseOpenApiSpec(spec);
      expect(ops[0].inputSchema.required).toEqual(['req1', 'req2']);
    });

    it('omits required array when no parameters are required', () => {
      const spec = {
        paths: {
          '/x': {
            get: {
              operationId: 'op',
              parameters: [{ name: 'opt', in: 'query', required: false }],
            },
          },
        },
      };

      const ops = parseOpenApiSpec(spec);
      expect(ops[0].inputSchema).not.toHaveProperty('required');
    });

    it('defaults to type: string when parameter schema is missing', () => {
      const spec = {
        paths: {
          '/x': {
            get: {
              operationId: 'op',
              parameters: [{ name: 'noSchema', in: 'query', description: 'no schema param' }],
            },
          },
        },
      };

      const ops = parseOpenApiSpec(spec);
      const props = ops[0].inputSchema.properties as Record<string, unknown>;
      expect(props.noSchema).toEqual({ type: 'string', description: 'no schema param' });
    });

    it('handles empty parameters array', () => {
      const spec = {
        paths: {
          '/x': { get: { operationId: 'op', parameters: [] } },
        },
      };

      const ops = parseOpenApiSpec(spec);
      expect(ops[0].inputSchema).toEqual({ type: 'object', properties: {} });
    });

    it('skips non-object parameter entries', () => {
      const spec = {
        paths: {
          '/x': {
            get: {
              operationId: 'op',
              parameters: ['not-an-object', 42, { name: 'valid', in: 'query', description: 'ok' }],
            },
          },
        },
      };

      const ops = parseOpenApiSpec(spec);
      const props = ops[0].inputSchema.properties as Record<string, unknown>;
      expect(Object.keys(props)).toEqual(['valid']);
    });

    it('skips parameter entries without a name', () => {
      const spec = {
        paths: {
          '/x': {
            get: {
              operationId: 'op',
              parameters: [
                { in: 'query' }, // missing name
                { name: '', in: 'query' }, // empty name (falsy)
                { name: 'valid', in: 'query', description: 'ok' },
              ],
            },
          },
        },
      };

      const ops = parseOpenApiSpec(spec);
      const props = ops[0].inputSchema.properties as Record<string, unknown>;
      expect(Object.keys(props)).toEqual(['valid']);
    });
  });

  // ─── requestBody ────────────────────────────────────────────────────────

  describe('requestBody', () => {
    it('includes requestBody as body property in inputSchema', () => {
      const spec = {
        paths: {
          '/users': {
            post: {
              operationId: 'createUser',
              summary: 'Create user',
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { name: { type: 'string' }, email: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      };

      const ops = parseOpenApiSpec(spec);
      const props = ops[0].inputSchema.properties as Record<string, Record<string, unknown>>;

      expect(props.body).toEqual({
        type: 'object',
        properties: { name: { type: 'string' }, email: { type: 'string' } },
        description: 'Request body',
      });
      expect(ops[0].inputSchema.required).toContain('body');
    });

    it('does not add body to required when requestBody.required is false', () => {
      const spec = {
        paths: {
          '/x': {
            post: {
              operationId: 'op',
              requestBody: {
                required: false,
                content: {
                  'application/json': {
                    schema: { type: 'object' },
                  },
                },
              },
            },
          },
        },
      };

      const ops = parseOpenApiSpec(spec);
      expect(ops[0].inputSchema).not.toHaveProperty('required');
    });

    it('does not add body to required when requestBody.required is missing', () => {
      const spec = {
        paths: {
          '/x': {
            post: {
              operationId: 'op',
              requestBody: {
                content: {
                  'application/json': {
                    schema: { type: 'object' },
                  },
                },
              },
            },
          },
        },
      };

      const ops = parseOpenApiSpec(spec);
      expect(ops[0].inputSchema).not.toHaveProperty('required');
    });

    it('ignores requestBody without application/json content', () => {
      const spec = {
        paths: {
          '/x': {
            post: {
              operationId: 'op',
              requestBody: {
                content: {
                  'text/plain': { schema: { type: 'string' } },
                },
              },
            },
          },
        },
      };

      const ops = parseOpenApiSpec(spec);
      const props = ops[0].inputSchema.properties as Record<string, unknown>;
      expect(props).not.toHaveProperty('body');
    });

    it('ignores requestBody without content', () => {
      const spec = {
        paths: {
          '/x': {
            post: {
              operationId: 'op',
              requestBody: {},
            },
          },
        },
      };

      const ops = parseOpenApiSpec(spec);
      const props = ops[0].inputSchema.properties as Record<string, unknown>;
      expect(props).not.toHaveProperty('body');
    });

    it('ignores requestBody when JSON content has no schema', () => {
      const spec = {
        paths: {
          '/x': {
            post: {
              operationId: 'op',
              requestBody: {
                content: {
                  'application/json': {},
                },
              },
            },
          },
        },
      };

      const ops = parseOpenApiSpec(spec);
      const props = ops[0].inputSchema.properties as Record<string, unknown>;
      expect(props).not.toHaveProperty('body');
    });

    it('combines parameters and requestBody in the same operation', () => {
      const spec = {
        paths: {
          '/items/{id}': {
            put: {
              operationId: 'updateItem',
              summary: 'Update item',
              parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: { type: 'object', properties: { name: { type: 'string' } } },
                  },
                },
              },
            },
          },
        },
      };

      const ops = parseOpenApiSpec(spec);
      const props = ops[0].inputSchema.properties as Record<string, unknown>;

      expect(Object.keys(props)).toEqual(['id', 'body']);
      expect(ops[0].inputSchema.required).toEqual(['id', 'body']);
    });
  });

  // ─── Edge cases ─────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('returns empty array when spec has no paths', () => {
      expect(parseOpenApiSpec({})).toEqual([]);
      expect(parseOpenApiSpec({ info: { title: 'test' } })).toEqual([]);
    });

    it('returns empty array when paths is undefined', () => {
      expect(parseOpenApiSpec({ paths: undefined } as unknown as Record<string, unknown>)).toEqual([]);
    });

    it('skips null pathItem entries', () => {
      const spec = {
        paths: {
          '/ok': { get: { operationId: 'op1' } },
          '/null': null,
        },
      };

      const ops = parseOpenApiSpec(spec as unknown as Record<string, unknown>);
      expect(ops).toHaveLength(1);
      expect(ops[0].path).toBe('/ok');
    });

    it('skips non-object pathItem entries', () => {
      const spec = {
        paths: {
          '/ok': { get: { operationId: 'op1' } },
          '/string': 'not-an-object',
        },
      };

      const ops = parseOpenApiSpec(spec as unknown as Record<string, unknown>);
      expect(ops).toHaveLength(1);
    });

    it('skips non-HTTP-method keys in pathItem', () => {
      const spec = {
        paths: {
          '/x': {
            get: { operationId: 'validOp' },
            summary: 'Path level summary',
            parameters: [{ name: 'shared', in: 'path' }],
            'x-custom': { custom: true },
          },
        },
      };

      const ops = parseOpenApiSpec(spec);
      expect(ops).toHaveLength(1);
      expect(ops[0].operationId).toBe('validOp');
    });

    it('skips null operation values', () => {
      const spec = {
        paths: {
          '/x': {
            get: null,
            post: { operationId: 'valid' },
          },
        },
      };

      const ops = parseOpenApiSpec(spec as unknown as Record<string, unknown>);
      expect(ops).toHaveLength(1);
      expect(ops[0].operationId).toBe('valid');
    });

    it('handles operation with no parameters field (defaults to empty)', () => {
      const spec = {
        paths: {
          '/x': {
            get: { operationId: 'noParams' },
          },
        },
      };

      const ops = parseOpenApiSpec(spec);
      expect(ops[0].inputSchema).toEqual({ type: 'object', properties: {} });
    });

    it('preserves parameter schema properties', () => {
      const spec = {
        paths: {
          '/x': {
            get: {
              operationId: 'op',
              parameters: [
                {
                  name: 'limit',
                  in: 'query',
                  description: 'Max results',
                  schema: { type: 'integer', minimum: 1, maximum: 100 },
                },
              ],
            },
          },
        },
      };

      const ops = parseOpenApiSpec(spec);
      const props = ops[0].inputSchema.properties as Record<string, Record<string, unknown>>;

      expect(props.limit).toEqual({
        type: 'integer',
        minimum: 1,
        maximum: 100,
        description: 'Max results',
      });
    });

    it('returns correct method as uppercase', () => {
      const spec = {
        paths: {
          '/x': {
            patch: { operationId: 'patchOp' },
          },
        },
      };

      const ops = parseOpenApiSpec(spec);
      expect(ops[0].method).toBe('PATCH');
    });

    it('handles empty paths object', () => {
      const spec = { paths: {} };
      expect(parseOpenApiSpec(spec)).toEqual([]);
    });
  });
});
