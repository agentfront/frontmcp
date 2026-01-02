/**
 * Unit tests for AgentRegistry
 */

import 'reflect-metadata';
import AgentRegistry from '../agent.registry';
import { Agent, AgentContext } from '../../common';
import { createProviderRegistryWithScope } from '../../__test-utils__/fixtures/scope.fixtures';
import { z } from 'zod';

// Mock LLM adapter for testing
const mockLlmAdapter = {
  completion: jest.fn().mockResolvedValue({
    content: 'Mock response',
    finishReason: 'stop',
  }),
  streamCompletion: jest.fn(),
};

describe('AgentRegistry', () => {
  describe('Basic Registration', () => {
    it('should register an agent with class decorator', async () => {
      @Agent({
        name: 'test-agent',
        description: 'A test agent',
        systemInstructions: 'You are a test agent',
        inputSchema: { message: z.string() },
        llm: { adapter: mockLlmAdapter },
      })
      class TestAgent extends AgentContext {
        override async execute(input: { message: string }) {
          return { response: `Echo: ${input.message}` };
        }
      }

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const registry = new AgentRegistry(providers, [TestAgent], owner);
      await registry.ready;

      const agents = registry.getAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe('test-agent');
      expect(agents[0].metadata.description).toBe('A test agent');
    });

    it('should register multiple agents', async () => {
      @Agent({
        name: 'agent-a',
        description: 'First agent',
        inputSchema: {},
        llm: { adapter: mockLlmAdapter },
      })
      class AgentA extends AgentContext {
        override async execute(_input: Record<string, never>) {
          return { result: 'A' };
        }
      }

      @Agent({
        name: 'agent-b',
        description: 'Second agent',
        inputSchema: {},
        llm: { adapter: mockLlmAdapter },
      })
      class AgentB extends AgentContext {
        override async execute(_input: Record<string, never>) {
          return { result: 'B' };
        }
      }

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const registry = new AgentRegistry(providers, [AgentA, AgentB], owner);
      await registry.ready;

      const agents = registry.getAgents();
      expect(agents).toHaveLength(2);
      expect(agents.map((a) => a.name)).toContain('agent-a');
      expect(agents.map((a) => a.name)).toContain('agent-b');
    });

    it('should generate unique IDs for agents', async () => {
      @Agent({
        name: 'unique-agent',
        inputSchema: {},
        llm: { adapter: mockLlmAdapter },
      })
      class UniqueAgent extends AgentContext {
        override async execute(_input: Record<string, never>) {
          return {};
        }
      }

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const registry = new AgentRegistry(providers, [UniqueAgent], owner);
      await registry.ready;

      const agent = registry.findByName('unique-agent');
      expect(agent).toBeDefined();
      expect(agent?.id).toBeDefined();
      expect(agent?.id.length).toBeGreaterThan(0);
    });
  });

  describe('Agent Lookup', () => {
    it('should find agent by ID', async () => {
      @Agent({
        id: 'custom-id',
        name: 'lookup-agent',
        inputSchema: {},
        llm: { adapter: mockLlmAdapter },
      })
      class LookupAgent extends AgentContext {
        override async execute(_input: Record<string, never>) {
          return {};
        }
      }

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const registry = new AgentRegistry(providers, [LookupAgent], owner);
      await registry.ready;

      const agent = registry.findById('custom-id');
      expect(agent).toBeDefined();
      // When id is provided, it's used as both id and name
      expect(agent?.id).toBe('custom-id');
    });

    it('should find agent by name', async () => {
      @Agent({
        name: 'named-agent',
        inputSchema: {},
        llm: { adapter: mockLlmAdapter },
      })
      class NamedAgent extends AgentContext {
        override async execute(_input: Record<string, never>) {
          return {};
        }
      }

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const registry = new AgentRegistry(providers, [NamedAgent], owner);
      await registry.ready;

      const agent = registry.findByName('named-agent');
      expect(agent).toBeDefined();
      expect(agent?.name).toBe('named-agent');
    });

    it('should return undefined for non-existent agent', async () => {
      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const registry = new AgentRegistry(providers, [], owner);
      await registry.ready;

      expect(registry.findById('non-existent')).toBeUndefined();
      expect(registry.findByName('non-existent')).toBeUndefined();
    });
  });

  describe('Hidden Agents', () => {
    it('should hide agents with hideFromDiscovery flag', async () => {
      @Agent({
        name: 'visible-agent',
        inputSchema: {},
        llm: { adapter: mockLlmAdapter },
      })
      class VisibleAgent extends AgentContext {
        override async execute(_input: Record<string, never>) {
          return {};
        }
      }

      @Agent({
        name: 'hidden-agent',
        inputSchema: {},
        hideFromDiscovery: true,
        llm: { adapter: mockLlmAdapter },
      })
      class HiddenAgent extends AgentContext {
        override async execute(_input: Record<string, never>) {
          return {};
        }
      }

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const registry = new AgentRegistry(providers, [VisibleAgent, HiddenAgent], owner);
      await registry.ready;

      // Without includeHidden
      const visibleAgents = registry.getAgents(false);
      expect(visibleAgents).toHaveLength(1);
      expect(visibleAgents[0].name).toBe('visible-agent');

      // With includeHidden
      const allAgents = registry.getAgents(true);
      expect(allAgents).toHaveLength(2);
    });
  });

  describe('Swarm Visibility', () => {
    it('should get visible agents for an agent with canSeeOtherAgents', async () => {
      @Agent({
        id: 'orchestrator',
        name: 'orchestrator-agent',
        inputSchema: {},
        swarm: { canSeeOtherAgents: true },
        llm: { adapter: mockLlmAdapter },
      })
      class OrchestratorAgent extends AgentContext {
        override async execute(_input: Record<string, never>) {
          return {};
        }
      }

      @Agent({
        id: 'worker',
        name: 'worker-agent',
        inputSchema: {},
        swarm: { isVisible: true },
        llm: { adapter: mockLlmAdapter },
      })
      class WorkerAgent extends AgentContext {
        override async execute(_input: Record<string, never>) {
          return {};
        }
      }

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const registry = new AgentRegistry(providers, [OrchestratorAgent, WorkerAgent], owner);
      await registry.ready;

      const visibleToOrchestrator = registry.getVisibleAgentsFor('orchestrator');
      expect(visibleToOrchestrator.map((a) => a.id)).toContain('worker');
    });

    it('should respect visibleAgents whitelist', async () => {
      @Agent({
        id: 'selective-agent',
        name: 'selective-agent',
        inputSchema: {},
        swarm: { canSeeOtherAgents: true, visibleAgents: ['allowed-agent'] },
        llm: { adapter: mockLlmAdapter },
      })
      class SelectiveAgent extends AgentContext {
        override async execute(_input: Record<string, never>) {
          return {};
        }
      }

      @Agent({
        id: 'allowed-agent',
        name: 'allowed-agent',
        inputSchema: {},
        llm: { adapter: mockLlmAdapter },
      })
      class AllowedAgent extends AgentContext {
        override async execute(_input: Record<string, never>) {
          return {};
        }
      }

      @Agent({
        id: 'blocked-agent',
        name: 'blocked-agent',
        inputSchema: {},
        llm: { adapter: mockLlmAdapter },
      })
      class BlockedAgent extends AgentContext {
        override async execute(_input: Record<string, never>) {
          return {};
        }
      }

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const registry = new AgentRegistry(providers, [SelectiveAgent, AllowedAgent, BlockedAgent], owner);
      await registry.ready;

      const visibleToSelective = registry.getVisibleAgentsFor('selective-agent');
      expect(visibleToSelective.map((a) => a.id)).toContain('allowed-agent');
      expect(visibleToSelective.map((a) => a.id)).not.toContain('blocked-agent');
    });

    it('should return empty array for agent that cannot see others', async () => {
      @Agent({
        id: 'isolated-agent',
        name: 'isolated-agent',
        inputSchema: {},
        swarm: { canSeeOtherAgents: false },
        llm: { adapter: mockLlmAdapter },
      })
      class IsolatedAgent extends AgentContext {
        override async execute(_input: Record<string, never>) {
          return {};
        }
      }

      @Agent({
        id: 'other-agent',
        name: 'other-agent',
        inputSchema: {},
        llm: { adapter: mockLlmAdapter },
      })
      class OtherAgent extends AgentContext {
        override async execute(_input: Record<string, never>) {
          return {};
        }
      }

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const registry = new AgentRegistry(providers, [IsolatedAgent, OtherAgent], owner);
      await registry.ready;

      const visibleToIsolated = registry.getVisibleAgentsFor('isolated-agent');
      expect(visibleToIsolated).toHaveLength(0);
    });
  });

  describe('Tool Definition Generation', () => {
    it('should generate tool definition for agent', async () => {
      @Agent({
        id: 'tool-agent',
        name: 'tool-agent',
        description: 'Agent that can be invoked as a tool',
        inputSchema: {
          query: z.string().describe('The query to process'),
        },
        llm: { adapter: mockLlmAdapter },
      })
      class ToolAgent extends AgentContext {
        override async execute(input: { query: string }) {
          return { result: input.query };
        }
      }

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const registry = new AgentRegistry(providers, [ToolAgent], owner);
      await registry.ready;

      const agent = registry.findById('tool-agent');
      expect(agent).toBeDefined();

      const toolDef = agent?.getToolDefinition();
      expect(toolDef).toBeDefined();
      expect(toolDef?.name).toBe('use-agent:tool-agent');
      expect(toolDef?.description).toContain('Agent that can be invoked as a tool');
    });
  });

  describe('Inline Agents', () => {
    it('should return inline agents only', async () => {
      @Agent({
        name: 'inline-agent',
        inputSchema: {},
        llm: { adapter: mockLlmAdapter },
      })
      class InlineAgent extends AgentContext {
        override async execute(_input: Record<string, never>) {
          return {};
        }
      }

      const providers = await createProviderRegistryWithScope();
      const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };

      const registry = new AgentRegistry(providers, [InlineAgent], owner);
      await registry.ready;

      const inlineAgents = registry.getInlineAgents();
      expect(inlineAgents).toHaveLength(1);
      expect(inlineAgents[0].name).toBe('inline-agent');
    });
  });
});
