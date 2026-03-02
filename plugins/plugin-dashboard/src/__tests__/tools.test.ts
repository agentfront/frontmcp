// file: plugins/plugin-dashboard/src/__tests__/tools.test.ts

import 'reflect-metadata';
import { z } from 'zod';
import { graphToolInputSchema, type GraphToolInput } from '../tools/graph.tool';
import {
  listToolsInputSchema,
  listToolsOutputSchema,
  type ListToolsInput,
  type ListToolsOutput,
} from '../tools/list-tools.tool';
import {
  listResourcesInputSchema,
  listResourcesOutputSchema,
  type ListResourcesInput,
  type ListResourcesOutput,
} from '../tools/list-resources.tool';

describe('Tool Schemas', () => {
  describe('graphToolInputSchema', () => {
    const schema = z.object(graphToolInputSchema);

    it('should parse empty input with defaults', () => {
      const result = schema.parse({});
      expect(result.includeSchemas).toBe(false);
      expect(result.refresh).toBe(false);
    });

    it('should parse includeSchemas option', () => {
      const result = schema.parse({ includeSchemas: true });
      expect(result.includeSchemas).toBe(true);
    });

    it('should parse refresh option', () => {
      const result = schema.parse({ refresh: true });
      expect(result.refresh).toBe(true);
    });

    it('should parse both options', () => {
      const result = schema.parse({ includeSchemas: true, refresh: true });
      expect(result.includeSchemas).toBe(true);
      expect(result.refresh).toBe(true);
    });

    it('should have descriptions for options', () => {
      const shape = schema.shape;
      expect(shape.includeSchemas.description).toContain('Include full input/output schemas');
      expect(shape.refresh.description).toContain('Force refresh');
    });
  });

  describe('listToolsInputSchema', () => {
    const schema = z.object(listToolsInputSchema);

    it('should parse empty input with defaults', () => {
      const result = schema.parse({});
      expect(result.includePlugins).toBe(true);
      expect(result.includeSchemas).toBe(false);
      expect(result.filter).toBeUndefined();
    });

    it('should parse filter option', () => {
      const result = schema.parse({ filter: 'my-.*' });
      expect(result.filter).toBe('my-.*');
    });

    it('should parse includePlugins option', () => {
      const result = schema.parse({ includePlugins: false });
      expect(result.includePlugins).toBe(false);
    });

    it('should parse includeSchemas option', () => {
      const result = schema.parse({ includeSchemas: true });
      expect(result.includeSchemas).toBe(true);
    });

    it('should parse all options', () => {
      const result = schema.parse({
        filter: 'test',
        includePlugins: false,
        includeSchemas: true,
      });
      expect(result.filter).toBe('test');
      expect(result.includePlugins).toBe(false);
      expect(result.includeSchemas).toBe(true);
    });
  });

  describe('listToolsOutputSchema', () => {
    it('should validate valid output', () => {
      const output: ListToolsOutput = {
        tools: [
          {
            name: 'tool1',
            fullName: 'prefix:tool1',
            description: 'A tool',
            tags: ['tag1'],
          },
        ],
        count: 1,
      };
      const result = listToolsOutputSchema.parse(output);
      expect(result.count).toBe(1);
      expect(result.tools).toHaveLength(1);
    });

    it('should validate output with schemas', () => {
      const output = {
        tools: [
          {
            name: 'tool1',
            fullName: 'tool1',
            inputSchema: { type: 'object' },
            outputSchema: { type: 'string' },
          },
        ],
        count: 1,
      };
      const result = listToolsOutputSchema.parse(output);
      expect(result.tools[0].inputSchema).toEqual({ type: 'object' });
    });

    it('should validate empty tools array', () => {
      const output = { tools: [], count: 0 };
      const result = listToolsOutputSchema.parse(output);
      expect(result.tools).toHaveLength(0);
      expect(result.count).toBe(0);
    });

    it('should validate tool without optional fields', () => {
      const output = {
        tools: [{ name: 'tool', fullName: 'tool' }],
        count: 1,
      };
      const result = listToolsOutputSchema.parse(output);
      expect(result.tools[0].description).toBeUndefined();
      expect(result.tools[0].tags).toBeUndefined();
    });
  });

  describe('listResourcesInputSchema', () => {
    const schema = z.object(listResourcesInputSchema);

    it('should parse empty input with defaults', () => {
      const result = schema.parse({});
      expect(result.includeTemplates).toBe(true);
      expect(result.filter).toBeUndefined();
    });

    it('should parse filter option', () => {
      const result = schema.parse({ filter: 'file://.*' });
      expect(result.filter).toBe('file://.*');
    });

    it('should parse includeTemplates option', () => {
      const result = schema.parse({ includeTemplates: false });
      expect(result.includeTemplates).toBe(false);
    });

    it('should parse both options', () => {
      const result = schema.parse({
        filter: 'test',
        includeTemplates: false,
      });
      expect(result.filter).toBe('test');
      expect(result.includeTemplates).toBe(false);
    });
  });

  describe('listResourcesOutputSchema', () => {
    it('should validate valid output', () => {
      const output: ListResourcesOutput = {
        resources: [
          {
            name: 'config',
            uri: 'file:///config.json',
            description: 'Config file',
            mimeType: 'application/json',
            isTemplate: false,
          },
        ],
        count: 1,
      };
      const result = listResourcesOutputSchema.parse(output);
      expect(result.count).toBe(1);
      expect(result.resources).toHaveLength(1);
    });

    it('should validate resource template', () => {
      const output = {
        resources: [
          {
            name: 'user-data',
            uri: 'user://{id}/data',
            isTemplate: true,
          },
        ],
        count: 1,
      };
      const result = listResourcesOutputSchema.parse(output);
      expect(result.resources[0].isTemplate).toBe(true);
    });

    it('should validate empty resources array', () => {
      const output = { resources: [], count: 0 };
      const result = listResourcesOutputSchema.parse(output);
      expect(result.resources).toHaveLength(0);
    });

    it('should validate resource without optional fields', () => {
      const output = {
        resources: [{ name: 'data', uri: 'data://test', isTemplate: false }],
        count: 1,
      };
      const result = listResourcesOutputSchema.parse(output);
      expect(result.resources[0].description).toBeUndefined();
      expect(result.resources[0].mimeType).toBeUndefined();
    });
  });
});

describe('Type exports', () => {
  it('should export GraphToolInput type', () => {
    const input: GraphToolInput = { includeSchemas: true, refresh: false };
    expect(input.includeSchemas).toBe(true);
  });

  it('should export ListToolsInput type', () => {
    const input: ListToolsInput = {
      filter: 'test',
      includePlugins: true,
      includeSchemas: false,
    };
    expect(input.filter).toBe('test');
  });

  it('should export ListToolsOutput type', () => {
    const output: ListToolsOutput = {
      tools: [],
      count: 0,
    };
    expect(output.count).toBe(0);
  });

  it('should export ListResourcesInput type', () => {
    const input: ListResourcesInput = {
      filter: 'test',
      includeTemplates: true,
    };
    expect(input.filter).toBe('test');
  });

  it('should export ListResourcesOutput type', () => {
    const output: ListResourcesOutput = {
      resources: [],
      count: 0,
    };
    expect(output.count).toBe(0);
  });
});
