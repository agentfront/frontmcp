import { z } from 'zod';
import { buildEsmToolRecord, buildEsmResourceRecord, buildEsmPromptRecord } from '../factories/esm-record-builders';
import type { EsmToolDefinition, EsmResourceDefinition, EsmPromptDefinition } from '../factories/esm-record-builders';

describe('esm-record-builders', () => {
  describe('buildEsmToolRecord()', () => {
    const baseTool: EsmToolDefinition = {
      name: 'echo',
      description: 'Echoes input',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      execute: jest.fn(),
    };

    it('builds a record with correct metadata', () => {
      const record = buildEsmToolRecord(baseTool);

      expect(record.kind).toBe('CLASS_TOKEN');
      expect(record.metadata.name).toBe('echo');
      expect(record.metadata.id).toBe('echo');
      expect(record.metadata.description).toBe('Echoes input');
      expect(record.metadata.rawInputSchema).toEqual(baseTool.inputSchema);
      expect(record.provide).toBeDefined();
    });

    it('adds namespace prefix when provided', () => {
      const record = buildEsmToolRecord(baseTool, 'my-pkg');
      expect(record.metadata.name).toBe('my-pkg:echo');
      expect(record.metadata.id).toBe('my-pkg:echo');
    });

    it('sets esm annotations', () => {
      const record = buildEsmToolRecord(baseTool);
      const annotations = record.metadata.annotations as Record<string, unknown>;
      expect(annotations['frontmcp:esm']).toBe(true);
      expect(annotations['frontmcp:esmTool']).toBe('echo');
    });

    it('uses default description when not provided', () => {
      const tool: EsmToolDefinition = { name: 'bare', execute: jest.fn() };
      const record = buildEsmToolRecord(tool);
      expect(record.metadata.description).toBe('ESM tool: bare');
    });

    it('provide is a class with the correct name', () => {
      const record = buildEsmToolRecord(baseTool);
      expect(record.provide.name).toBe('EsmTool_echo');
    });

    it('routes JSON Schema to rawInputSchema', () => {
      const jsonSchema = {
        type: 'object',
        properties: { text: { type: 'string' } },
      };
      const tool: EsmToolDefinition = {
        name: 'json-tool',
        inputSchema: jsonSchema,
        execute: jest.fn(),
      };
      const record = buildEsmToolRecord(tool);
      expect(record.metadata.rawInputSchema).toEqual(jsonSchema);
      expect(record.metadata.inputSchema).toEqual({});
    });

    it('routes Zod raw shape to inputSchema (not rawInputSchema)', () => {
      const zodShape = {
        message: z.string(),
        count: z.number().optional(),
      };
      const tool: EsmToolDefinition = {
        name: 'zod-tool',
        inputSchema: zodShape as unknown as Record<string, unknown>,
        execute: jest.fn(),
      };
      const record = buildEsmToolRecord(tool);
      expect(record.metadata.inputSchema).toEqual(zodShape);
      expect(record.metadata.rawInputSchema).toBeUndefined();
    });

    it('handles undefined inputSchema', () => {
      const tool: EsmToolDefinition = {
        name: 'no-schema',
        execute: jest.fn(),
      };
      const record = buildEsmToolRecord(tool);
      expect(record.metadata.inputSchema).toEqual({});
      expect(record.metadata.rawInputSchema).toBeUndefined();
    });
  });

  describe('buildEsmResourceRecord()', () => {
    const baseResource: EsmResourceDefinition = {
      name: 'status',
      description: 'Server status',
      uri: 'status://server',
      mimeType: 'application/json',
      read: jest.fn(),
    };

    it('builds a record with correct metadata', () => {
      const record = buildEsmResourceRecord(baseResource);

      expect(record.kind).toBe('CLASS_TOKEN');
      expect(record.metadata.name).toBe('status');
      expect(record.metadata.description).toBe('Server status');
      expect(record.metadata.uri).toBe('status://server');
      expect(record.metadata.mimeType).toBe('application/json');
    });

    it('adds namespace prefix when provided', () => {
      const record = buildEsmResourceRecord(baseResource, 'ns');
      expect(record.metadata.name).toBe('ns:status');
    });

    it('uses default description when not provided', () => {
      const resource: EsmResourceDefinition = {
        name: 'bare',
        uri: 'bare://res',
        read: jest.fn(),
      };
      const record = buildEsmResourceRecord(resource);
      expect(record.metadata.description).toBe('ESM resource: bare');
    });

    it('provide is a class with the correct name', () => {
      const record = buildEsmResourceRecord(baseResource);
      expect(record.provide.name).toBe('EsmResource_status');
    });
  });

  describe('buildEsmPromptRecord()', () => {
    const basePrompt: EsmPromptDefinition = {
      name: 'greeter',
      description: 'Greets a user',
      arguments: [
        { name: 'name', description: 'Name', required: true },
        { name: 'style', description: 'Style', required: false },
      ],
      execute: jest.fn(),
    };

    it('builds a record with correct metadata', () => {
      const record = buildEsmPromptRecord(basePrompt);

      expect(record.kind).toBe('CLASS_TOKEN');
      expect(record.metadata.name).toBe('greeter');
      expect(record.metadata.description).toBe('Greets a user');
      expect(record.metadata.arguments).toEqual([
        { name: 'name', description: 'Name', required: true },
        { name: 'style', description: 'Style', required: false },
      ]);
    });

    it('adds namespace prefix when provided', () => {
      const record = buildEsmPromptRecord(basePrompt, 'pkg');
      expect(record.metadata.name).toBe('pkg:greeter');
    });

    it('uses default description when not provided', () => {
      const prompt: EsmPromptDefinition = { name: 'bare', execute: jest.fn() };
      const record = buildEsmPromptRecord(prompt);
      expect(record.metadata.description).toBe('ESM prompt: bare');
    });

    it('uses empty arguments array when not provided', () => {
      const prompt: EsmPromptDefinition = { name: 'no-args', execute: jest.fn() };
      const record = buildEsmPromptRecord(prompt);
      expect(record.metadata.arguments).toEqual([]);
    });

    it('provide is a class with the correct name', () => {
      const record = buildEsmPromptRecord(basePrompt);
      expect(record.provide.name).toBe('EsmPrompt_greeter');
    });
  });
});
