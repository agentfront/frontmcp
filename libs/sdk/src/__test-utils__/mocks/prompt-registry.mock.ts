/// <reference types="jest" />
/**
 * Mock factory for PromptRegistry
 */

import { PromptMetadata, PromptKind, PromptRecord, PromptEntry } from '../../common';

/**
 * Creates a mock PromptRegistry for testing
 */
export function createMockPromptRegistry(overrides: Partial<Record<string, unknown>> = {}) {
  const prompts = new Map<string, ReturnType<typeof createMockPromptEntry>>();

  return {
    prompts,
    ready: Promise.resolve(),
    owner: { kind: 'app', id: 'test-app', ref: {} },

    getPrompts: jest.fn(() => {
      return Array.from(prompts.values());
    }),

    getInlinePrompts: jest.fn(() => {
      return Array.from(prompts.values());
    }),

    findByName: jest.fn((name: string) => {
      // First try exact match
      if (prompts.has(name)) {
        return prompts.get(name);
      }
      // Then try to find by metadata.name
      for (const prompt of prompts.values()) {
        if (prompt.metadata?.name === name || prompt.name === name) {
          return prompt;
        }
      }
      return undefined;
    }),

    findAllByName: jest.fn((name: string) => {
      const results: ReturnType<typeof createMockPromptEntry>[] = [];
      for (const prompt of prompts.values()) {
        if (prompt.metadata?.name === name || prompt.name === name) {
          results.push(prompt);
        }
      }
      return results;
    }),

    listAllIndexed: jest.fn(() => {
      return Array.from(prompts.values());
    }),

    exportResolvedNames: jest.fn(() => {
      const result: Array<{ name: string; instance: ReturnType<typeof createMockPromptEntry> }> = [];
      prompts.forEach((instance, name) => {
        result.push({ name, instance });
      });
      return result;
    }),

    hasAny: jest.fn(() => prompts.size > 0),

    listByOwner: jest.fn((ownerId: string) => {
      const results: ReturnType<typeof createMockPromptEntry>[] = [];
      for (const prompt of prompts.values()) {
        if (prompt.owner?.id === ownerId) {
          results.push(prompt);
        }
      }
      return results;
    }),

    ...overrides,
  };
}

/**
 * Creates a mock prompt entry
 */
export function createMockPromptEntry(
  name: string,
  metadata?: Partial<PromptMetadata>,
  execute?: (args: Record<string, string>) => unknown,
) {
  const fullMetadata: PromptMetadata = {
    name,
    description: `Mock prompt: ${name}`,
    arguments: [],
    ...metadata,
  };

  return {
    name,
    fullName: `test-app:${name}`,
    metadata: fullMetadata,
    owner: { kind: 'app', id: 'test-app', ref: {} },
    execute: jest.fn(
      execute ||
        ((_args: Record<string, string>) => ({
          messages: [{ role: 'user', content: { type: 'text', text: `Response from ${name}` } }],
        })),
    ),
    parseArguments: jest.fn((args?: Record<string, string>) => {
      // Validate required arguments
      const requiredArgs = fullMetadata.arguments?.filter((a) => a.required) || [];
      for (const arg of requiredArgs) {
        if (!args?.[arg.name]) {
          throw new Error(`Missing required argument: ${arg.name}`);
        }
      }
      return args || {};
    }),
    parseOutput: jest.fn((output: unknown) => {
      if (typeof output === 'string') {
        return {
          messages: [{ role: 'user', content: { type: 'text', text: output } }],
          description: fullMetadata.description,
        };
      }
      if (output && typeof output === 'object' && 'messages' in output) {
        const outputObj = output as { messages: unknown[]; description?: string };
        return { ...outputObj, description: outputObj.description || fullMetadata.description };
      }
      return {
        messages: [{ role: 'user', content: { type: 'text', text: JSON.stringify(output) } }],
        description: fullMetadata.description,
      };
    }),
    safeParseOutput: jest.fn((output: unknown) => {
      try {
        let parsed: { messages: unknown[]; description?: string };
        if (typeof output === 'string') {
          parsed = {
            messages: [{ role: 'user', content: { type: 'text', text: output } }],
            description: fullMetadata.description,
          };
        } else if (output && typeof output === 'object' && 'messages' in output) {
          const outputObj = output as { messages: unknown[]; description?: string };
          parsed = { ...outputObj, description: outputObj.description || fullMetadata.description };
        } else {
          parsed = {
            messages: [{ role: 'user', content: { type: 'text', text: JSON.stringify(output) } }],
            description: fullMetadata.description,
          };
        }
        return { success: true, data: parsed };
      } catch (error) {
        return { success: false, error };
      }
    }),
    getMetadata: jest.fn(() => fullMetadata),
    create: jest.fn((args: Record<string, string>, ctx?: unknown) => ({
      args,
      ctx,
      output: undefined,
      execute: execute || (() => ({ messages: [] })),
      mark: jest.fn(),
    })),
    record: {
      kind: PromptKind.CLASS_TOKEN,
      provide: class MockPromptEntry {} as unknown as new () => PromptEntry,
      metadata: fullMetadata,
    } as PromptRecord,
  };
}

/**
 * Adds a prompt to a mock registry
 */
export function addPromptToMock(
  registry: ReturnType<typeof createMockPromptRegistry>,
  name: string,
  promptEntry: ReturnType<typeof createMockPromptEntry>,
) {
  registry.prompts.set(name, promptEntry);

  registry.findByName.mockImplementation((n: string) => {
    if (registry.prompts.has(n)) {
      return registry.prompts.get(n);
    }
    for (const prompt of registry.prompts.values()) {
      if (prompt.metadata?.name === n || prompt.name === n) {
        return prompt;
      }
    }
    return undefined;
  });

  registry.getPrompts.mockImplementation(() => Array.from(registry.prompts.values()));
  registry.getInlinePrompts.mockImplementation(() => Array.from(registry.prompts.values()));
  registry.hasAny.mockImplementation(() => registry.prompts.size > 0);
}
