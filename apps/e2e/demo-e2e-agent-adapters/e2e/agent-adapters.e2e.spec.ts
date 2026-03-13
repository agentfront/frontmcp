/**
 * E2E Tests for Agent Adapters with Real OpenAI/Anthropic SDK Types
 *
 * These tests exercise the full agent execution pipeline:
 *   adapter formats messages → calls mock LLM → LLM returns tool_calls →
 *   tools execute → results fed back → LLM returns final response
 *
 * All agents use the default runAgentLoop() path (no execute() override).
 * Mock clients use real OpenAI/Anthropic SDK types to prove adapter compatibility.
 */
import { test, expect } from '@frontmcp/testing';

test.describe('Agent Adapters E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-agent-adapters/src/main.ts',
    project: 'demo-e2e-agent-adapters',
    publicMode: true,
  });

  // ═══════════════════════════════════════════════════════════════════
  // REGISTRATION TESTS
  // ═══════════════════════════════════════════════════════════════════

  test.describe('Agent Registration', () => {
    test('should register all 6 agents as invoke_ tools', async ({ mcp }) => {
      const tools = await mcp.tools.list();

      expect(tools).toContainTool('invoke_openai-chat-agent');
      expect(tools).toContainTool('invoke_openai-responses-agent');
      expect(tools).toContainTool('invoke_anthropic-agent');
      expect(tools).toContainTool('invoke_multi-tool-agent');
      expect(tools).toContainTool('invoke_notifying-agent');
      expect(tools).toContainTool('invoke_error-agent');
    });

    test('should have correct number of agent tools', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      const agentTools = tools.filter((t) => t.name.startsWith('invoke_'));
      expect(agentTools.length).toBe(6);
    });

    test('should have query field with required in input schemas', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      const agentTools = tools.filter((t) => t.name.startsWith('invoke_'));

      for (const tool of agentTools) {
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema?.properties?.query).toBeDefined();
        expect(tool.inputSchema?.required).toContain('query');
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // OPENAI CHAT ADAPTER TESTS
  // ═══════════════════════════════════════════════════════════════════

  test.describe('OpenAI Chat Adapter', () => {
    test('should complete full tool call lifecycle', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_openai-chat-agent', {
        query: 'Look up test-key',
      });

      expect(result).toBeSuccessful();
      // The mock returns get-data({key:"test-key"}) → tool returns value_for_test-key
      // → mock returns final text with tool result
      const text = result.text();
      expect(text).toContain('value_for_test-key');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // OPENAI RESPONSES API ADAPTER TESTS
  // ═══════════════════════════════════════════════════════════════════

  test.describe('OpenAI Responses API Adapter', () => {
    test('should complete full tool call lifecycle via Responses API', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_openai-responses-agent', {
        query: 'Look up responses-key',
      });

      expect(result).toBeSuccessful();
      const text = result.text();
      expect(text).toContain('value_for_responses-key');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // ANTHROPIC ADAPTER TESTS
  // ═══════════════════════════════════════════════════════════════════

  test.describe('Anthropic Adapter', () => {
    test('should complete full tool call lifecycle with tool_use/tool_result', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_anthropic-agent', {
        query: 'Look up anthropic-key',
      });

      expect(result).toBeSuccessful();
      const text = result.text();
      expect(text).toContain('value_for_anthropic-key');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // MULTI-TOOL CALL TESTS
  // ═══════════════════════════════════════════════════════════════════

  test.describe('Multi-Tool Calls', () => {
    test('should execute two tools in single turn and combine results', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_multi-tool-agent', {
        query: 'Get data and add numbers',
      });

      expect(result).toBeSuccessful();
      const text = result.text();
      // get-data({key:"multi-key"}) returns {"data":"value_for_multi-key","source":"mock-db"}
      expect(text).toContain('value_for_multi-key');
      // add-numbers({a:7,b:3}) returns {"result":10}
      expect(text).toContain('10');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // ERROR HANDLING TESTS
  // ═══════════════════════════════════════════════════════════════════

  test.describe('Error Handling', () => {
    test('should propagate tool errors through execution loop', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_error-agent', {
        query: 'Trigger the failing tool',
      });

      expect(result).toBeSuccessful();
      const text = result.text();
      // The failing tool throws "Intentional test failure"
      // The loop catches the error and sends it back as tool result
      // The mock incorporates the error message in its final response
      expect(text).toContain('Intentional test failure');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // NOTIFICATIONS TESTS
  // ═══════════════════════════════════════════════════════════════════

  test.describe('Notifications', () => {
    test('should complete with auto-progress enabled', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_notifying-agent', {
        query: 'Process with notifications',
      });

      expect(result).toBeSuccessful();
      const text = result.text();
      expect(text).toContain('value_for_test-key');
    });

    test('should have log entries from notifications', async ({ mcp }) => {
      await mcp.tools.call('invoke_notifying-agent', {
        query: 'Generate notifications',
      });

      const logs = mcp.logs.all();
      expect(logs.length).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // CONCURRENT EXECUTION TESTS
  // ═══════════════════════════════════════════════════════════════════

  test.describe('Concurrent Execution', () => {
    test('should handle three different adapter agents concurrently', async ({ mcp }) => {
      const results = await Promise.all([
        mcp.tools.call('invoke_openai-chat-agent', { query: 'concurrent-1' }),
        mcp.tools.call('invoke_anthropic-agent', { query: 'concurrent-2' }),
        mcp.tools.call('invoke_openai-responses-agent', { query: 'concurrent-3' }),
      ]);

      results.forEach((result) => {
        expect(result).toBeSuccessful();
      });
    });
  });
});
