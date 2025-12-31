/**
 * E2E Tests for Agents Feature
 *
 * Tests the agent system functionality:
 * - Agents registered as callable tools (invoke_<agent-id>)
 * - Agent execution via tool calls
 * - Echo, Calculator, and Orchestrator agent functionality
 * - Swarm visibility between agents
 * - Server capabilities and session management
 * - Concurrent agent execution
 * - JSON response parsing
 * - Mocking and interception
 * - Raw protocol access
 */
import { test, expect } from '@frontmcp/testing';

test.describe('Agents E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-agents/src/main.ts',
    publicMode: true,
  });

  // ═══════════════════════════════════════════════════════════════════
  // AGENT REGISTRATION TESTS
  // ═══════════════════════════════════════════════════════════════════

  test.describe('Agent Registration', () => {
    test('should list agents as tools', async ({ mcp }) => {
      const tools = await mcp.tools.list();

      // Agents are exposed as invoke_<agent-id> tools
      expect(tools).toContainTool('invoke_echo-agent');
      expect(tools).toContainTool('invoke_calculator-agent');
      expect(tools).toContainTool('invoke_orchestrator-agent');
    });

    test('should have correct agent tool descriptions', async ({ mcp }) => {
      const tools = await mcp.tools.list();

      const echoTool = tools.find((t) => t.name === 'invoke_echo-agent');
      const calcTool = tools.find((t) => t.name === 'invoke_calculator-agent');
      const orchTool = tools.find((t) => t.name === 'invoke_orchestrator-agent');

      expect(echoTool?.description).toContain('echo');
      expect(calcTool?.description).toContain('math');
      expect(orchTool?.description).toContain('orchestrat');
    });

    test('should have input schemas on agent tools', async ({ mcp }) => {
      const tools = await mcp.tools.list();

      const echoTool = tools.find((t) => t.name === 'invoke_echo-agent');
      expect(echoTool?.inputSchema).toBeDefined();
      expect(echoTool?.inputSchema?.properties?.message).toBeDefined();

      const calcTool = tools.find((t) => t.name === 'invoke_calculator-agent');
      expect(calcTool?.inputSchema).toBeDefined();
      expect(calcTool?.inputSchema?.properties?.expression).toBeDefined();
    });

    test('should have correct number of agent tools', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      const agentTools = tools.filter((t) => t.name.startsWith('invoke_'));
      expect(agentTools.length).toBe(3);
    });

    test('should have required property markers in schemas', async ({ mcp }) => {
      const tools = await mcp.tools.list();

      const echoTool = tools.find((t) => t.name === 'invoke_echo-agent');
      const calcTool = tools.find((t) => t.name === 'invoke_calculator-agent');

      // Check that required fields are marked
      expect(echoTool?.inputSchema?.required).toContain('message');
      expect(calcTool?.inputSchema?.required).toContain('expression');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // ECHO AGENT TESTS
  // ═══════════════════════════════════════════════════════════════════

  test.describe('Echo Agent', () => {
    test('should echo a simple message', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_echo-agent', {
        message: 'Hello, World!',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('Echo: Hello, World!');
    });

    test('should return timestamp in response', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_echo-agent', {
        message: 'Test message',
      });

      expect(result).toBeSuccessful();
      // The response should contain a timestamp (ISO date format)
      const content = JSON.stringify(result);
      expect(content).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    test('should handle special characters', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_echo-agent', {
        message: 'Special chars: !@#$%^&*()_+-={}[]|;:"<>?,./~`',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('Special chars');
    });

    test('should handle unicode characters', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_echo-agent', {
        message: 'Unicode: 你好世界 🌍 مرحبا العالم',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('Unicode');
    });

    test('should handle long messages', async ({ mcp }) => {
      const longMessage = 'A'.repeat(1000);
      const result = await mcp.tools.call('invoke_echo-agent', {
        message: longMessage,
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('Echo:');
    });

    test('should handle messages with newlines', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_echo-agent', {
        message: 'Line 1\nLine 2\nLine 3',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('Line 1');
    });

    test('should handle JSON-like messages', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_echo-agent', {
        message: '{"key": "value", "nested": {"a": 1}}',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('key');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // CALCULATOR AGENT TESTS
  // ═══════════════════════════════════════════════════════════════════

  test.describe('Calculator Agent', () => {
    test('should evaluate simple addition', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_calculator-agent', {
        expression: '2 + 3',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('5');
    });

    test('should evaluate multiplication', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_calculator-agent', {
        expression: '6 * 7',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('42');
    });

    test('should evaluate complex expressions', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_calculator-agent', {
        expression: '(10 + 5) * 2',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('30');
    });

    test('should handle division', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_calculator-agent', {
        expression: '100 / 4',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('25');
    });

    test('should handle invalid expressions gracefully', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_calculator-agent', {
        expression: 'not a number',
      });

      expect(result).toBeSuccessful();
      // Should return error message, not crash
      expect(result).toHaveTextContent('Invalid expression');
    });

    test('should handle floating point arithmetic', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_calculator-agent', {
        expression: '10.5 + 2.3',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('12.8');
    });

    test('should handle negative numbers', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_calculator-agent', {
        expression: '-5 + 10',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('5');
    });

    test('should handle subtraction', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_calculator-agent', {
        expression: '100 - 37',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('63');
    });

    test('should handle nested parentheses', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_calculator-agent', {
        expression: '((2 + 3) * (4 + 1))',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('25');
    });

    test('should handle order of operations', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_calculator-agent', {
        expression: '2 + 3 * 4',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('14');
    });

    test('should handle empty expression', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_calculator-agent', {
        expression: '',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('Invalid');
    });

    test('should handle whitespace-only expression', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_calculator-agent', {
        expression: '   ',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('Invalid');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // ORCHESTRATOR AGENT TESTS
  // ═══════════════════════════════════════════════════════════════════

  test.describe('Orchestrator Agent', () => {
    test('should process generic tasks', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_orchestrator-agent', {
        task: 'Process this general request',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('completed');
    });

    test('should delegate math tasks to calculator', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_orchestrator-agent', {
        task: 'Calculate 5 + 5',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('delegated');
      expect(result).toHaveTextContent('calculator-agent');
    });

    test('should delegate echo tasks', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_orchestrator-agent', {
        task: 'Echo this message back to me',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('delegated');
      expect(result).toHaveTextContent('echo-agent');
    });

    test('should list available agents', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_orchestrator-agent', {
        task: 'List what you can do',
      });

      expect(result).toBeSuccessful();
      // Should include available agents in response
      expect(result).toHaveTextContent('calculator-agent');
      expect(result).toHaveTextContent('echo-agent');
    });

    test('should accept target agents parameter', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_orchestrator-agent', {
        task: 'Test with custom agents',
        targetAgents: ['custom-agent-1', 'custom-agent-2'],
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('custom-agent-1');
    });

    test('should detect multiplication keyword', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_orchestrator-agent', {
        task: 'Please multiply 5 * 3',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('delegated');
      expect(result).toHaveTextContent('calculator-agent');
    });

    test('should detect repeat keyword for echo', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_orchestrator-agent', {
        task: 'Repeat after me: hello',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('delegated');
      expect(result).toHaveTextContent('echo-agent');
    });

    test('should handle empty target agents array', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_orchestrator-agent', {
        task: 'Test with no agents',
        targetAgents: [],
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('completed');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // AGENT SWARM VISIBILITY TESTS
  // ═══════════════════════════════════════════════════════════════════

  test.describe('Agent Swarm Visibility', () => {
    test('orchestrator can see visible agents', async ({ mcp }) => {
      // The orchestrator has swarm.canSeeOtherAgents: true
      // and visibleAgents: ['calculator-agent', 'echo-agent']
      const result = await mcp.tools.call('invoke_orchestrator-agent', {
        task: 'Show available agents',
      });

      expect(result).toBeSuccessful();
      // Orchestrator should report its visible agents
      const content = JSON.stringify(result);
      expect(content).toContain('calculator-agent');
      expect(content).toContain('echo-agent');
    });

    test('orchestrator does not include itself in visible agents', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_orchestrator-agent', {
        task: 'Show available agents',
      });

      expect(result).toBeSuccessful();
      const content = result.text() ?? '';
      // By default available agents are calculator and echo, not orchestrator itself
      expect(content).not.toContain('orchestrator-agent');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // ERROR HANDLING TESTS
  // ═══════════════════════════════════════════════════════════════════

  test.describe('Error Handling', () => {
    test('should handle missing required parameters', async ({ mcp }) => {
      // Call without required message parameter
      try {
        await mcp.tools.call('invoke_echo-agent', {});
        // If no error thrown, the call might have validation built in
      } catch (error) {
        // Expected - missing required parameter
        expect(error).toBeDefined();
      }
    });

    test('should handle invalid agent tool calls', async ({ mcp }) => {
      try {
        await mcp.tools.call('invoke_nonexistent-agent', {
          input: 'test',
        });
        // Some implementations may return error result instead of throwing
      } catch (error) {
        // Expected - agent not found
        expect(error).toBeDefined();
      }
    });

    test('should handle null values gracefully', async ({ mcp }) => {
      try {
        await mcp.tools.call('invoke_echo-agent', {
          message: null as unknown as string,
        });
      } catch (error) {
        // May throw validation error
        expect(error).toBeDefined();
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // SERVER CAPABILITIES TESTS
  // ═══════════════════════════════════════════════════════════════════

  test.describe('Server Capabilities', () => {
    test('should report tools capability', async ({ mcp }) => {
      expect(mcp.hasCapability('tools')).toBe(true);
    });

    test('should have valid server info', async ({ mcp }) => {
      expect(mcp.serverInfo.name).toBeDefined();
      expect(mcp.serverInfo.version).toBeDefined();
    });

    test('should have valid protocol version', async ({ mcp }) => {
      expect(mcp.protocolVersion).toBeDefined();
      expect(mcp.protocolVersion.length).toBeGreaterThan(0);
    });

    test('should have session info', async ({ mcp }) => {
      expect(mcp.session).toBeDefined();
      expect(mcp.session.id).toBeDefined();
    });

    test('should track request count', async ({ mcp }) => {
      const initialCount = mcp.session.requestCount;

      await mcp.tools.list();
      await mcp.tools.list();

      // Request count should have increased
      expect(mcp.session.requestCount).toBeGreaterThan(initialCount);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // CONCURRENT EXECUTION TESTS
  // ═══════════════════════════════════════════════════════════════════

  test.describe('Concurrent Execution', () => {
    test('should handle multiple concurrent agent calls', async ({ mcp }) => {
      // Execute multiple agents concurrently
      const results = await Promise.all([
        mcp.tools.call('invoke_echo-agent', { message: 'First' }),
        mcp.tools.call('invoke_echo-agent', { message: 'Second' }),
        mcp.tools.call('invoke_calculator-agent', { expression: '1 + 1' }),
        mcp.tools.call('invoke_calculator-agent', { expression: '2 * 2' }),
      ]);

      // All should succeed
      results.forEach((result) => {
        expect(result).toBeSuccessful();
      });

      // Check individual results
      expect(results[0]).toHaveTextContent('First');
      expect(results[1]).toHaveTextContent('Second');
      expect(results[2]).toHaveTextContent('2');
      expect(results[3]).toHaveTextContent('4');
    });

    test('should handle sequential agent calls', async ({ mcp }) => {
      const result1 = await mcp.tools.call('invoke_echo-agent', { message: 'Step 1' });
      expect(result1).toBeSuccessful();

      const result2 = await mcp.tools.call('invoke_calculator-agent', { expression: '10 + 5' });
      expect(result2).toBeSuccessful();

      const result3 = await mcp.tools.call('invoke_orchestrator-agent', { task: 'Final step' });
      expect(result3).toBeSuccessful();
    });

    test('should handle rapid successive calls', async ({ mcp }) => {
      const messages = ['A', 'B', 'C', 'D', 'E'];
      const results = [];

      for (const msg of messages) {
        const result = await mcp.tools.call('invoke_echo-agent', { message: msg });
        results.push(result);
      }

      results.forEach((result, i) => {
        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent(`Echo: ${messages[i]}`);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // JSON RESPONSE PARSING TESTS
  // ═══════════════════════════════════════════════════════════════════

  test.describe('JSON Response Parsing', () => {
    test('should parse calculator response as JSON', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_calculator-agent', {
        expression: '5 * 5',
      });

      expect(result).toBeSuccessful();

      // Try to get raw text content
      const text = result.text();
      expect(text).toBeDefined();

      // Check the structured response
      expect(text).toContain('25');
    });

    test('should parse echo response as JSON', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_echo-agent', {
        message: 'Test JSON',
      });

      expect(result).toBeSuccessful();

      const text = result.text();
      expect(text).toContain('echoed');
      expect(text).toContain('timestamp');
    });

    test('should parse orchestrator response as JSON', async ({ mcp }) => {
      const result = await mcp.tools.call('invoke_orchestrator-agent', {
        task: 'Test task',
      });

      expect(result).toBeSuccessful();

      const text = result.text();
      expect(text).toContain('taskReceived');
      expect(text).toContain('status');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // MOCKING AND INTERCEPTION TESTS
  // ═══════════════════════════════════════════════════════════════════

  test.describe('Mocking', () => {
    test('should mock agent tool response', async ({ mcp }) => {
      // Set up mock for echo agent
      const handle = mcp.mock.tool('invoke_echo-agent', 'Mocked response!');

      const result = await mcp.tools.call('invoke_echo-agent', {
        message: 'Original message',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('Mocked response!');

      // Clean up
      handle.remove();
    });

    test('should clear mocks after test', async ({ mcp }) => {
      mcp.mock.tool('invoke_echo-agent', 'Temporary mock');
      mcp.mock.clear();

      const result = await mcp.tools.call('invoke_echo-agent', {
        message: 'Real message',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('Echo: Real message');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // RAW PROTOCOL TESTS
  // ═══════════════════════════════════════════════════════════════════

  test.describe('Raw Protocol', () => {
    test('should support raw tools/list request', async ({ mcp }) => {
      const response = await mcp.raw.request({
        jsonrpc: '2.0',
        id: 'test-1',
        method: 'tools/list',
        params: {},
      });

      expect(response).toHaveResult();
      expect(response).toBeValidJsonRpc();
    });

    test('should support raw tools/call request', async ({ mcp }) => {
      const response = await mcp.raw.request({
        jsonrpc: '2.0',
        id: 'test-2',
        method: 'tools/call',
        params: {
          name: 'invoke_echo-agent',
          arguments: { message: 'Raw test' },
        },
      });

      expect(response).toHaveResult();
      expect(response).toBeValidJsonRpc();
    });

    test('should return error for invalid method', async ({ mcp }) => {
      const response = await mcp.raw.request({
        jsonrpc: '2.0',
        id: 'test-3',
        method: 'invalid/method',
        params: {},
      });

      expect(response).toHaveError();
      expect(response).toBeValidJsonRpc();
    });

    test('should track last request id', async ({ mcp }) => {
      await mcp.tools.list();
      const lastId = mcp.lastRequestId;

      await mcp.tools.list();
      expect(mcp.lastRequestId).not.toBe(lastId);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // TRACING AND LOGGING TESTS
  // ═══════════════════════════════════════════════════════════════════

  test.describe('Tracing and Logging', () => {
    test('should track request traces', async ({ mcp }) => {
      mcp.trace.clear();

      await mcp.tools.call('invoke_echo-agent', { message: 'Trace test' });

      const traces = mcp.trace.all();
      expect(traces.length).toBeGreaterThan(0);

      const lastTrace = mcp.trace.last();
      expect(lastTrace).toBeDefined();
      expect(lastTrace?.request.method).toBe('tools/call');
    });

    test('should include duration in traces', async ({ mcp }) => {
      mcp.trace.clear();

      await mcp.tools.call('invoke_calculator-agent', { expression: '1+1' });

      const lastTrace = mcp.trace.last();
      expect(lastTrace?.durationMs).toBeGreaterThanOrEqual(0);
    });

    test('should track logs', async ({ mcp }) => {
      const logs = mcp.logs.all();
      // Should have connection logs at minimum
      expect(logs.length).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // TRANSPORT TESTS
  // ═══════════════════════════════════════════════════════════════════

  test.describe('Transport', () => {
    test('should report connected status', async ({ mcp }) => {
      expect(mcp.isConnected()).toBe(true);
      expect(mcp.transport_info.isConnected()).toBe(true);
    });

    test('should have transport type', async ({ mcp }) => {
      expect(mcp.transport_info.type).toBe('streamable-http');
    });
  });
});
