// file: libs/plugins/src/codecall/__tests__/describe.utils.test.ts

import {
  detectToolIntent,
  ToolIntent,
  generateSmartExample,
  generateCreateExample,
  generateGetExample,
  generateListExample,
  generateUpdateExample,
  generateDeleteExample,
  generateSearchExample,
  hasPaginationParams,
  hasFilterParams,
  getFilterProperties,
  generateBasicExample,
  generatePaginationExample,
  generateFilterExample,
  jsonSchemaToSignature,
  jsonSchemaToNaturalLanguage,
} from '../utils/describe.utils';

describe('detectToolIntent', () => {
  describe('Create Intent Detection', () => {
    const createVerbs = [
      'create',
      'add',
      'new',
      'insert',
      'make',
      'append',
      'register',
      'generate',
      'produce',
      'build',
      'construct',
      'provision',
    ];

    it.each(createVerbs)('should detect "create" intent for verb "%s"', (verb) => {
      expect(detectToolIntent(`users:${verb}`)).toBe('create');
      expect(detectToolIntent(`${verb}User`)).toBe('create');
    });

    it('should detect create from tool name', () => {
      expect(detectToolIntent('users:create')).toBe('create');
      expect(detectToolIntent('orders:add')).toBe('create');
      expect(detectToolIntent('products:new')).toBe('create');
    });
  });

  describe('Delete Intent Detection', () => {
    const deleteVerbs = ['delete', 'remove', 'destroy', 'drop', 'erase', 'clear', 'purge', 'discard', 'eliminate'];

    it.each(deleteVerbs)('should detect "delete" intent for verb "%s"', (verb) => {
      expect(detectToolIntent(`users:${verb}`)).toBe('delete');
    });

    it('should detect delete from tool name', () => {
      expect(detectToolIntent('users:delete')).toBe('delete');
      expect(detectToolIntent('orders:remove')).toBe('delete');
    });
  });

  describe('Get Intent Detection', () => {
    const getVerbs = ['get', 'fetch', 'retrieve', 'read', 'obtain', 'load', 'pull', 'access'];

    it.each(getVerbs)('should detect "get" intent for verb "%s"', (verb) => {
      expect(detectToolIntent(`users:${verb}`)).toBe('get');
    });

    it('should detect get from tool name', () => {
      expect(detectToolIntent('users:get')).toBe('get');
      expect(detectToolIntent('orders:fetch')).toBe('get');
    });
  });

  describe('Update Intent Detection', () => {
    const updateVerbs = ['update', 'edit', 'modify', 'change', 'patch', 'set', 'alter', 'revise'];

    it.each(updateVerbs)('should detect "update" intent for verb "%s"', (verb) => {
      expect(detectToolIntent(`users:${verb}`)).toBe('update');
    });

    it('should detect update from tool name', () => {
      expect(detectToolIntent('users:update')).toBe('update');
      expect(detectToolIntent('orders:edit')).toBe('update');
      expect(detectToolIntent('profile:patch')).toBe('update');
    });
  });

  describe('List Intent Detection', () => {
    const listVerbs = ['list', 'all', 'index', 'enumerate', 'show', 'display', 'view', 'browse'];

    it.each(listVerbs)('should detect "list" intent for verb "%s"', (verb) => {
      expect(detectToolIntent(`users:${verb}`)).toBe('list');
    });

    it('should detect list from tool name', () => {
      expect(detectToolIntent('users:list')).toBe('list');
      expect(detectToolIntent('orders:all')).toBe('list');
    });
  });

  describe('Search Intent Detection', () => {
    const searchVerbs = ['search', 'find', 'query', 'lookup', 'locate', 'discover'];

    it.each(searchVerbs)('should detect "search" intent for verb "%s"', (verb) => {
      expect(detectToolIntent(`users:${verb}`)).toBe('search');
    });

    it('should detect search from tool name', () => {
      expect(detectToolIntent('users:search')).toBe('search');
      expect(detectToolIntent('products:find')).toBe('search');
    });
  });

  describe('Unknown Intent', () => {
    it('should return unknown for unrecognized verbs', () => {
      expect(detectToolIntent('users:process')).toBe('unknown');
      expect(detectToolIntent('users:handle')).toBe('unknown');
      expect(detectToolIntent('custom-action')).toBe('unknown');
    });
  });

  describe('Description-based Detection (Fallback)', () => {
    it('should detect create from description when name is ambiguous', () => {
      expect(detectToolIntent('process', 'Creates a new record')).toBe('create');
    });

    it('should detect delete from description when name is ambiguous', () => {
      expect(detectToolIntent('process', 'Deletes the record')).toBe('delete');
    });

    it('should detect get from description when name is ambiguous', () => {
      expect(detectToolIntent('process', 'Gets user information')).toBe('get');
    });

    it('should detect update from description when name is ambiguous', () => {
      expect(detectToolIntent('process', 'Updates user profile')).toBe('update');
    });

    it('should detect list from description when name is ambiguous', () => {
      expect(detectToolIntent('process', 'Lists all users')).toBe('list');
    });

    it('should detect search from description when name is ambiguous', () => {
      expect(detectToolIntent('process', 'Searches for users')).toBe('search');
    });
  });
});

describe('Intent-Specific Example Generators', () => {
  describe('generateCreateExample', () => {
    it('should generate create example with entity name', () => {
      const result = generateCreateExample('users:create');
      expect(result.description).toBe('Create a new user');
      expect(result.code).toContain("callTool('users:create'");
    });

    it('should include required parameters from schema', () => {
      const schema = {
        type: 'object' as const,
        properties: {
          email: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['email', 'name'],
      };

      const result = generateCreateExample('users:create', schema);
      expect(result.code).toContain('email');
      expect(result.code).toContain('name');
    });
  });

  describe('generateGetExample', () => {
    it('should generate get example with entity name', () => {
      const result = generateGetExample('users:get');
      expect(result.description).toContain('user');
      expect(result.code).toContain("callTool('users:get'");
    });

    it('should detect ID parameter', () => {
      const schema = {
        type: 'object' as const,
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      };

      const result = generateGetExample('users:get', schema);
      expect(result.description).toBe('Get user by id');
      expect(result.code).toContain('id:');
    });

    it('should detect userId parameter', () => {
      const schema = {
        type: 'object' as const,
        properties: {
          userId: { type: 'string' },
        },
        required: ['userId'],
      };

      const result = generateGetExample('users:get', schema);
      expect(result.description).toBe('Get user by userId');
      expect(result.code).toContain('userId:');
    });
  });

  describe('generateListExample', () => {
    it('should generate list example with entity name', () => {
      const result = generateListExample('users:list');
      expect(result.description).toBe('List all users');
      expect(result.code).toContain("callTool('users:list'");
    });

    it('should not include pagination code (use generatePaginationExample instead)', () => {
      const result = generateListExample('users:list');
      expect(result.code).not.toContain('offset');
    });
  });

  describe('generateUpdateExample', () => {
    it('should generate update example with entity name', () => {
      const result = generateUpdateExample('users:update');
      expect(result.description).toContain('user');
      expect(result.code).toContain("callTool('users:update'");
    });

    it('should include ID parameter when present', () => {
      const schema = {
        type: 'object' as const,
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['id'],
      };

      const result = generateUpdateExample('users:update', schema);
      expect(result.description).toBe('Update user by id');
      expect(result.code).toContain('id:');
    });
  });

  describe('generateDeleteExample', () => {
    it('should generate delete example with entity name', () => {
      const result = generateDeleteExample('users:delete');
      expect(result.description).toContain('user');
      expect(result.code).toContain("callTool('users:delete'");
    });

    it('should detect ID parameter', () => {
      const schema = {
        type: 'object' as const,
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      };

      const result = generateDeleteExample('users:delete', schema);
      expect(result.description).toBe('Delete user by id');
      expect(result.code).toContain('id:');
    });
  });

  describe('generateSearchExample', () => {
    it('should generate search example with entity name', () => {
      const result = generateSearchExample('users:search');
      expect(result.description).toBe('Search for users');
      expect(result.code).toContain("callTool('users:search'");
    });

    it('should detect query parameter', () => {
      const schema = {
        type: 'object' as const,
        properties: {
          query: { type: 'string' },
        },
      };

      const result = generateSearchExample('users:search', schema);
      expect(result.code).toContain('query:');
    });

    it('should detect search parameter', () => {
      const schema = {
        type: 'object' as const,
        properties: {
          searchTerm: { type: 'string' },
        },
      };

      const result = generateSearchExample('users:search', schema);
      expect(result.code).toContain('searchTerm:');
    });
  });
});

describe('generateSmartExample', () => {
  it('should route to create example for create tools', () => {
    const result = generateSmartExample('users:create');
    expect(result.description).toBe('Create a new user');
  });

  it('should route to get example for get tools', () => {
    const result = generateSmartExample('users:get');
    expect(result.description).toContain('user');
  });

  it('should route to list example for list tools', () => {
    const result = generateSmartExample('users:list');
    expect(result.description).toBe('List all users');
  });

  it('should route to update example for update tools', () => {
    const result = generateSmartExample('users:update');
    expect(result.description).toContain('user');
  });

  it('should route to delete example for delete tools', () => {
    const result = generateSmartExample('users:delete');
    expect(result.description).toContain('user');
  });

  it('should route to search example for search tools', () => {
    const result = generateSmartExample('users:search');
    expect(result.description).toBe('Search for users');
  });

  it('should use pagination example for list tools with pagination params', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        limit: { type: 'number' },
        offset: { type: 'number' },
      },
    };

    const result = generateSmartExample('users:list', schema);
    expect(result.code).toContain('limit');
    expect(result.code).toContain('offset');
  });

  it('should fall back to basic example for unknown intent', () => {
    const result = generateSmartExample('something:process');
    expect(result.description).toContain('Basic usage');
  });
});

describe('hasPaginationParams', () => {
  it('should return true for schemas with limit parameter', () => {
    const schema = {
      type: 'object' as const,
      properties: { limit: { type: 'number' } },
    };
    expect(hasPaginationParams(schema)).toBe(true);
  });

  it('should return true for schemas with offset parameter', () => {
    const schema = {
      type: 'object' as const,
      properties: { offset: { type: 'number' } },
    };
    expect(hasPaginationParams(schema)).toBe(true);
  });

  it('should return true for schemas with page parameter', () => {
    const schema = {
      type: 'object' as const,
      properties: { page: { type: 'number' } },
    };
    expect(hasPaginationParams(schema)).toBe(true);
  });

  it('should return true for schemas with cursor parameter', () => {
    const schema = {
      type: 'object' as const,
      properties: { cursor: { type: 'string' } },
    };
    expect(hasPaginationParams(schema)).toBe(true);
  });

  it('should return false for schemas without pagination params', () => {
    const schema = {
      type: 'object' as const,
      properties: { id: { type: 'string' } },
    };
    expect(hasPaginationParams(schema)).toBe(false);
  });

  it('should return false for undefined schema', () => {
    expect(hasPaginationParams(undefined)).toBe(false);
  });
});

describe('Entity Name Extraction', () => {
  it('should extract and singularize entity from tool name', () => {
    const result = generateCreateExample('users:create');
    expect(result.description).toBe('Create a new user');
  });

  it('should handle entity names ending in "ss"', () => {
    const result = generateCreateExample('access:create');
    expect(result.description).toBe('Create a new access');
  });

  it('should handle non-namespaced tool names', () => {
    const result = generateCreateExample('createUser');
    expect(result.description).toBe('Create a new createUser');
  });
});

describe('jsonSchemaToSignature', () => {
  it('should generate signature for tool with input and output schema', () => {
    const inputSchema = {
      type: 'object' as const,
      properties: {
        id: { type: 'string' as const },
        name: { type: 'string' as const },
      },
      required: ['id'],
    };
    const outputSchema = {
      type: 'object' as const,
      properties: {
        success: { type: 'boolean' as const },
      },
    };

    const result = jsonSchemaToSignature('users:get', inputSchema, outputSchema);
    expect(result).toContain("callTool('users:get'");
    expect(result).toContain('id: string');
    expect(result).toContain('name?: string');
    expect(result).toContain('Promise<');
    expect(result).toContain('success?: boolean');
  });

  it('should handle tool with no input schema', () => {
    const result = jsonSchemaToSignature('users:list');
    expect(result).toContain("callTool('users:list', {})");
    expect(result).toContain('Promise<unknown>');
  });

  it('should handle tool with no output schema', () => {
    const inputSchema = {
      type: 'object' as const,
      properties: {
        id: { type: 'string' as const },
      },
      required: ['id'],
    };

    const result = jsonSchemaToSignature('users:get', inputSchema);
    expect(result).toContain('id: string');
    expect(result).toContain('Promise<unknown>');
  });

  it('should handle enum types in schema', () => {
    const inputSchema = {
      type: 'object' as const,
      properties: {
        status: { enum: ['active', 'inactive', 'pending'] },
      },
      required: ['status'],
    };

    const result = jsonSchemaToSignature('users:update', inputSchema);
    expect(result).toContain('"active"');
    expect(result).toContain('"inactive"');
    expect(result).toContain('"pending"');
  });

  it('should handle array types in schema', () => {
    const inputSchema = {
      type: 'object' as const,
      properties: {
        tags: { type: 'array' as const, items: { type: 'string' as const } },
      },
    };

    const result = jsonSchemaToSignature('users:update', inputSchema);
    expect(result).toContain('string[]');
  });

  it('should handle array type without items', () => {
    const inputSchema = {
      type: 'object' as const,
      properties: {
        data: { type: 'array' as const },
      },
    };

    const result = jsonSchemaToSignature('users:update', inputSchema);
    expect(result).toContain('unknown[]');
  });

  it('should handle number and integer types', () => {
    const inputSchema = {
      type: 'object' as const,
      properties: {
        count: { type: 'number' as const },
        index: { type: 'integer' as const },
      },
    };

    const result = jsonSchemaToSignature('test:tool', inputSchema);
    expect(result).toContain('count?: number');
    expect(result).toContain('index?: number');
  });

  it('should handle boolean type', () => {
    const inputSchema = {
      type: 'object' as const,
      properties: {
        active: { type: 'boolean' as const },
      },
    };

    const result = jsonSchemaToSignature('test:tool', inputSchema);
    expect(result).toContain('active?: boolean');
  });

  it('should handle null type', () => {
    const inputSchema = {
      type: 'object' as const,
      properties: {
        value: { type: 'null' as const },
      },
    };

    const result = jsonSchemaToSignature('test:tool', inputSchema);
    expect(result).toContain('value?: null');
  });

  it('should handle nested object types', () => {
    const inputSchema = {
      type: 'object' as const,
      properties: {
        user: {
          type: 'object' as const,
          properties: {
            name: { type: 'string' as const },
          },
        },
      },
    };

    const result = jsonSchemaToSignature('test:tool', inputSchema);
    expect(result).toContain('user?:');
    expect(result).toContain('name?: string');
  });

  it('should handle object type without properties', () => {
    const inputSchema = {
      type: 'object' as const,
      properties: {
        metadata: { type: 'object' as const },
      },
    };

    const result = jsonSchemaToSignature('test:tool', inputSchema);
    expect(result).toContain('Record<string, unknown>');
  });

  it('should handle union types (array of types)', () => {
    const inputSchema = {
      type: 'object' as const,
      properties: {
        value: { type: ['string', 'number'] as unknown as 'string' },
      },
    };

    const result = jsonSchemaToSignature('test:tool', inputSchema);
    expect(result).toContain('string | number');
  });

  it('should handle oneOf types', () => {
    const inputSchema = {
      type: 'object' as const,
      properties: {
        value: {
          oneOf: [{ type: 'string' as const }, { type: 'number' as const }],
        },
      },
    };

    const result = jsonSchemaToSignature('test:tool', inputSchema);
    expect(result).toContain('string | number');
  });

  it('should handle anyOf types', () => {
    const inputSchema = {
      type: 'object' as const,
      properties: {
        value: {
          anyOf: [{ type: 'boolean' as const }, { type: 'string' as const }],
        },
      },
    };

    const result = jsonSchemaToSignature('test:tool', inputSchema);
    expect(result).toContain('boolean | string');
  });

  it('should handle empty properties object', () => {
    const inputSchema = {
      type: 'object' as const,
      properties: {},
    };

    const result = jsonSchemaToSignature('test:tool', inputSchema);
    expect(result).toContain('{}');
  });

  it('should handle schema with boolean property schema', () => {
    const inputSchema = {
      type: 'object' as const,
      properties: {
        valid: true as unknown,
        data: { type: 'string' as const },
      },
    };

    const result = jsonSchemaToSignature('test:tool', inputSchema);
    expect(result).toContain('data?: string');
  });

  it('should handle non-object schema as input', () => {
    const inputSchema = { type: 'string' as const };

    const result = jsonSchemaToSignature('test:tool', inputSchema);
    expect(result).toContain('string');
  });

  it('should handle schema with unknown type', () => {
    const inputSchema = {
      type: 'object' as const,
      properties: {
        value: { type: 'custom' as unknown as 'string' },
      },
    };

    const result = jsonSchemaToSignature('test:tool', inputSchema);
    expect(result).toContain('unknown');
  });

  it('should handle schema without type', () => {
    const inputSchema = {
      type: 'object' as const,
      properties: {
        value: { description: 'some value' },
      },
    };

    const result = jsonSchemaToSignature('test:tool', inputSchema);
    expect(result).toContain('unknown');
  });
});

describe('jsonSchemaToNaturalLanguage', () => {
  it('should return "No input parameters" for undefined input schema', () => {
    const result = jsonSchemaToNaturalLanguage(undefined, 'input');
    expect(result).toBe('No input parameters');
  });

  it('should return "Returns unspecified data" for undefined output schema', () => {
    const result = jsonSchemaToNaturalLanguage(undefined, 'output');
    expect(result).toBe('Returns unspecified data');
  });

  it('should return "No input parameters" for null input schema', () => {
    const result = jsonSchemaToNaturalLanguage(null, 'input');
    expect(result).toBe('No input parameters');
  });

  it('should return schema description if available', () => {
    const schema = {
      type: 'object' as const,
      description: 'User profile data with contact information',
      properties: {},
    };

    const result = jsonSchemaToNaturalLanguage(schema, 'input');
    expect(result).toBe('User profile data with contact information');
  });

  it('should return "No parameters required" for empty input properties', () => {
    const schema = {
      type: 'object' as const,
      properties: {},
    };

    const result = jsonSchemaToNaturalLanguage(schema, 'input');
    expect(result).toBe('No parameters required');
  });

  it('should return "Returns an empty object" for empty output properties', () => {
    const schema = {
      type: 'object' as const,
      properties: {},
    };

    const result = jsonSchemaToNaturalLanguage(schema, 'output');
    expect(result).toBe('Returns an empty object');
  });

  it('should list required parameters', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        id: { type: 'string' as const },
        name: { type: 'string' as const },
      },
      required: ['id', 'name'],
    };

    const result = jsonSchemaToNaturalLanguage(schema, 'input');
    expect(result).toContain('Required: id, name');
  });

  it('should list optional parameters', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        limit: { type: 'number' as const },
        offset: { type: 'number' as const },
      },
    };

    const result = jsonSchemaToNaturalLanguage(schema, 'input');
    expect(result).toContain('Optional: limit, offset');
  });

  it('should list both required and optional parameters', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        id: { type: 'string' as const },
        name: { type: 'string' as const },
        age: { type: 'number' as const },
      },
      required: ['id'],
    };

    const result = jsonSchemaToNaturalLanguage(schema, 'input');
    expect(result).toContain('Required: id');
    expect(result).toContain('Optional: name, age');
  });

  it('should handle non-object schema for input', () => {
    const schema = { type: 'string' as const };

    const result = jsonSchemaToNaturalLanguage(schema, 'input');
    expect(result).toBe('Takes a string');
  });

  it('should handle non-object schema for output', () => {
    const schema = { type: 'array' as const };

    const result = jsonSchemaToNaturalLanguage(schema, 'output');
    expect(result).toBe('Returns a array');
  });

  it('should handle schema without type', () => {
    const schema = { description: undefined } as unknown;

    const result = jsonSchemaToNaturalLanguage(schema, 'input');
    expect(result).toBe('Takes a value');
  });
});

describe('generateBasicExample', () => {
  it('should generate basic example for tool without schema', () => {
    const result = generateBasicExample('users:action');
    expect(result.description).toBe('Basic usage of users:action');
    expect(result.code).toContain("callTool('users:action', {})");
  });

  it('should generate basic example with sample params from schema', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        userId: { type: 'string' as const },
        email: { type: 'string' as const },
      },
      required: ['userId', 'email'],
    };

    const result = generateBasicExample('users:action', schema);
    expect(result.code).toContain('abc123');
    expect(result.code).toContain('user@example.com');
  });

  it('should use default values from schema', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        format: { type: 'string' as const, default: 'json' },
      },
      required: ['format'],
    };

    const result = generateBasicExample('export:data', schema);
    expect(result.code).toContain('json');
  });

  it('should use enum values from schema', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        status: { enum: ['active', 'inactive'] },
      },
      required: ['status'],
    };

    const result = generateBasicExample('users:filter', schema);
    expect(result.code).toContain('active');
  });

  it('should use const values from schema', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        version: { const: 'v1' },
      },
      required: ['version'],
    };

    const result = generateBasicExample('api:call', schema);
    expect(result.code).toContain('v1');
  });

  it('should generate contextual sample for name fields', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const },
      },
      required: ['name'],
    };

    const result = generateBasicExample('users:create', schema);
    expect(result.code).toContain('Example');
  });

  it('should generate contextual sample for url fields', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        url: { type: 'string' as const },
      },
      required: ['url'],
    };

    const result = generateBasicExample('links:create', schema);
    expect(result.code).toContain('https://example.com');
  });

  it('should generate sample for limit fields', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        limit: { type: 'number' as const },
      },
      required: ['limit'],
    };

    const result = generateBasicExample('users:list', schema);
    expect(result.code).toContain('10');
  });

  it('should generate sample for offset fields', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        offset: { type: 'integer' as const },
      },
      required: ['offset'],
    };

    const result = generateBasicExample('users:list', schema);
    expect(result.code).toContain('0');
  });

  it('should generate sample for page fields', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        page: { type: 'number' as const },
      },
      required: ['page'],
    };

    const result = generateBasicExample('users:list', schema);
    expect(result.code).toContain('1');
  });

  it('should generate sample for boolean fields', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        active: { type: 'boolean' as const },
      },
      required: ['active'],
    };

    const result = generateBasicExample('users:filter', schema);
    expect(result.code).toContain('true');
  });

  it('should generate sample for array fields', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        tags: { type: 'array' as const },
      },
      required: ['tags'],
    };

    const result = generateBasicExample('posts:create', schema);
    expect(result.code).toContain('[]');
  });

  it('should generate sample for object fields', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        metadata: { type: 'object' as const },
      },
      required: ['metadata'],
    };

    const result = generateBasicExample('items:create', schema);
    expect(result.code).toContain('{}');
  });

  it('should return null for schema without required properties', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        optional: { type: 'string' as const },
      },
    };

    const result = generateBasicExample('test:tool', schema);
    expect(result.code).toContain('{}');
  });

  it('should skip boolean property schemas', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        valid: true as unknown,
      },
      required: ['valid'],
    };

    const result = generateBasicExample('test:tool', schema);
    expect(result.code).toContain('{}');
  });

  it('should handle non-object schema', () => {
    const schema = { type: 'string' as const };

    const result = generateBasicExample('test:tool', schema);
    expect(result.code).toContain('{}');
  });

  it('should handle schema with array type', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        value: { type: ['string', 'number'] as unknown as 'string' },
      },
      required: ['value'],
    };

    const result = generateBasicExample('test:tool', schema);
    // First type in array should be used
    expect(result.code).toContain('"value"');
  });

  it('should handle unknown type with null fallback', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        unknown: { type: 'custom' as unknown as 'string' },
      },
      required: ['unknown'],
    };

    const result = generateBasicExample('test:tool', schema);
    expect(result.code).toContain('null');
  });
});

describe('generatePaginationExample', () => {
  it('should generate pagination example with limit and offset', () => {
    const result = generatePaginationExample('users:list');
    expect(result.description).toContain('Pagination example');
    expect(result.code).toContain('limit: 10');
    expect(result.code).toContain('offset: 0');
    expect(result.code).toContain('offset: 10');
    expect(result.code).toContain('page1');
    expect(result.code).toContain('page2');
  });
});

describe('generateFilterExample', () => {
  it('should generate filter example with specified property', () => {
    const result = generateFilterExample('users:list', 'status');
    expect(result.description).toBe('Filter by status');
    expect(result.code).toContain("callTool('users:list', { status: 'value' })");
  });

  it('should include result handling', () => {
    const result = generateFilterExample('orders:list', 'type');
    expect(result.code).toContain('filtered.items || filtered');
  });
});

describe('hasFilterParams', () => {
  it('should return true for schemas with filter parameter', () => {
    const schema = {
      type: 'object' as const,
      properties: { filter: { type: 'string' } },
    };
    expect(hasFilterParams(schema)).toBe(true);
  });

  it('should return true for schemas with query parameter', () => {
    const schema = {
      type: 'object' as const,
      properties: { query: { type: 'string' } },
    };
    expect(hasFilterParams(schema)).toBe(true);
  });

  it('should return true for schemas with search parameter', () => {
    const schema = {
      type: 'object' as const,
      properties: { searchTerm: { type: 'string' } },
    };
    expect(hasFilterParams(schema)).toBe(true);
  });

  it('should return true for schemas with status parameter', () => {
    const schema = {
      type: 'object' as const,
      properties: { status: { type: 'string' } },
    };
    expect(hasFilterParams(schema)).toBe(true);
  });

  it('should return true for schemas with type parameter', () => {
    const schema = {
      type: 'object' as const,
      properties: { type: { type: 'string' } },
    };
    expect(hasFilterParams(schema)).toBe(true);
  });

  it('should return true for schemas with role parameter', () => {
    const schema = {
      type: 'object' as const,
      properties: { role: { type: 'string' } },
    };
    expect(hasFilterParams(schema)).toBe(true);
  });

  it('should return false for schemas without filter params', () => {
    const schema = {
      type: 'object' as const,
      properties: { id: { type: 'string' }, name: { type: 'string' } },
    };
    expect(hasFilterParams(schema)).toBe(false);
  });

  it('should return false for undefined schema', () => {
    expect(hasFilterParams(undefined)).toBe(false);
  });

  it('should return false for non-object schema', () => {
    const schema = { type: 'string' as const };
    expect(hasFilterParams(schema)).toBe(false);
  });

  it('should return false for schema without properties', () => {
    const schema = { type: 'object' as const };
    expect(hasFilterParams(schema)).toBe(false);
  });
});

describe('getFilterProperties', () => {
  it('should return filter-like property names', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        id: { type: 'string' },
        filter: { type: 'string' },
        status: { type: 'string' },
        name: { type: 'string' },
      },
    };

    const result = getFilterProperties(schema);
    expect(result).toContain('filter');
    expect(result).toContain('status');
    expect(result).not.toContain('id');
    expect(result).not.toContain('name');
  });

  it('should return properties containing "filter"', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        userFilter: { type: 'string' },
        filterBy: { type: 'string' },
      },
    };

    const result = getFilterProperties(schema);
    expect(result).toContain('userFilter');
    expect(result).toContain('filterBy');
  });

  it('should return properties containing "query"', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        searchQuery: { type: 'string' },
      },
    };

    const result = getFilterProperties(schema);
    expect(result).toContain('searchQuery');
  });

  it('should return type and role properties', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        type: { type: 'string' },
        role: { type: 'string' },
      },
    };

    const result = getFilterProperties(schema);
    expect(result).toContain('type');
    expect(result).toContain('role');
  });

  it('should return empty array for undefined schema', () => {
    expect(getFilterProperties(undefined)).toEqual([]);
  });

  it('should return empty array for non-object schema', () => {
    const schema = { type: 'string' as const };
    expect(getFilterProperties(schema)).toEqual([]);
  });

  it('should return empty array for schema without properties', () => {
    const schema = { type: 'object' as const };
    expect(getFilterProperties(schema)).toEqual([]);
  });

  it('should return empty array for schema with no filter params', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
      },
    };
    expect(getFilterProperties(schema)).toEqual([]);
  });
});

describe('generateGetExample edge cases', () => {
  it('should fallback to basic example without ID parameter', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const },
      },
      required: ['name'],
    };

    const result = generateGetExample('users:get', schema);
    expect(result.description).toBe('Get user details');
    expect(result.code).toContain('Example');
  });

  it('should detect non-required ID parameter as fallback', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        id: { type: 'string' as const },
      },
    };

    const result = generateGetExample('users:get', schema);
    expect(result.description).toBe('Get user by id');
  });
});

describe('generateUpdateExample edge cases', () => {
  it('should generate update fields excluding ID-like fields', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        id: { type: 'string' as const },
        userId: { type: 'string' as const },
        name: { type: 'string' as const },
        email: { type: 'string' as const },
        age: { type: 'number' as const },
      },
      required: ['id'],
    };

    const result = generateUpdateExample('users:update', schema);
    expect(result.code).not.toContain('"userId"');
    expect(result.code).toContain('id:');
  });

  it('should handle schema with only ID fields', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        id: { type: 'string' as const },
        userId: { type: 'string' as const },
      },
    };

    const result = generateUpdateExample('users:update', schema);
    // When id is found as parameter but no update fields are available
    expect(result.description).toBe('Update user by id');
    expect(result.code).toContain('id:');
  });

  it('should handle schema without ID parameter', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const },
        email: { type: 'string' as const },
      },
    };

    const result = generateUpdateExample('users:update', schema);
    expect(result.description).toBe('Update user');
    expect(result.code).toContain('name');
    expect(result.code).toContain('email');
  });

  it('should skip boolean property schemas in update fields', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        id: { type: 'string' as const },
        valid: true as unknown,
        name: { type: 'string' as const },
      },
      required: ['id'],
    };

    const result = generateUpdateExample('users:update', schema);
    expect(result.code).toContain('name');
  });
});

describe('generateDeleteExample edge cases', () => {
  it('should fallback when no ID parameter found', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const },
      },
      required: ['name'],
    };

    const result = generateDeleteExample('users:delete', schema);
    expect(result.description).toBe('Delete user');
    expect(result.code).toContain('Example');
  });
});

describe('generateSearchExample edge cases', () => {
  it('should fallback to default query param when none found', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        id: { type: 'string' as const },
      },
    };

    const result = generateSearchExample('users:search', schema);
    expect(result.code).toContain('query:');
  });

  it('should detect keyword parameter', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        keyword: { type: 'string' as const },
      },
    };

    const result = generateSearchExample('users:search', schema);
    expect(result.code).toContain('keyword:');
  });

  it('should detect term parameter', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        term: { type: 'string' as const },
      },
    };

    const result = generateSearchExample('users:search', schema);
    expect(result.code).toContain('term:');
  });

  it('should detect q parameter', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        q: { type: 'string' as const },
      },
    };

    const result = generateSearchExample('users:search', schema);
    expect(result.code).toContain('q:');
  });
});
