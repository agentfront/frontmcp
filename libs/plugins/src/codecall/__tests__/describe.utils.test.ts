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
