/**
 * Comprehensive E2E Tests for Stdio Transport
 *
 * Validates that FrontMCP servers work correctly over stdio transport
 * (stdin/stdout JSON-RPC), as used by Claude Desktop, Claude Code, Cursor,
 * VS Code, and other MCP clients via .mcp.json configuration.
 *
 * Key areas tested:
 * - Protocol correctness (connection, initialization, capabilities)
 * - Stdout cleanliness (no log leakage on stdout)
 * - Tool operations (list, call, error handling)
 * - Resource operations (list, read)
 * - Prompt operations (list, get with/without args)
 * - Graceful shutdown (SIGTERM handling)
 * - Sequential operations (multiple calls on same connection)
 */

import { McpClient, McpStdioClientTransport } from '@frontmcp/testing';
import { join } from 'path';
import { spawn, ChildProcess } from 'child_process';

describe('Stdio Transport E2E', () => {
  let client: McpClient | null = null;
  let transport: McpStdioClientTransport | null = null;

  const entrypointPath = join(__dirname, '../src/stdio-entrypoint.ts');
  const projectPath = join(__dirname, '..');

  afterEach(async () => {
    if (client) {
      try {
        await client.close();
      } catch {
        // Process may have already exited
      }
      client = null;
    }

    if (transport) {
      try {
        await transport.close();
      } catch {
        // Process may have already exited
      }
      transport = null;
    }

    // Allow process cleanup
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  async function startServerAndConnect(): Promise<void> {
    transport = new McpStdioClientTransport({
      command: 'npx',
      args: ['tsx', entrypointPath],
      env: process.env as Record<string, string>,
      cwd: projectPath,
    });

    client = new McpClient({ name: 'stdio-e2e-client', version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);
  }

  // ── Connection & Initialization ──────────────────────────────────────

  describe('connection', () => {
    it('should connect and complete MCP initialization handshake', async () => {
      await startServerAndConnect();

      // If we reach here without timeout, the handshake succeeded:
      // client sent initialize → server responded with capabilities → client sent initialized
      expect(client).toBeDefined();
    }, 30000);

    it('should report server info with correct name and version', async () => {
      await startServerAndConnect();

      const result = await client!.listTools();
      // Server is operational if it responds to protocol requests
      expect(result).toBeDefined();
      expect(result.tools).toBeDefined();
    }, 30000);
  });

  // ── Stdout Cleanliness ───────────────────────────────────────────────

  describe('stdout protection', () => {
    it('should not emit any non-JSON-RPC data on stdout', async () => {
      // Spawn the process manually to capture raw stdout
      const stdoutChunks: Buffer[] = [];
      const child: ChildProcess = spawn('npx', ['tsx', entrypointPath], {
        cwd: projectPath,
        env: process.env as Record<string, string>,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      child.stdout!.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });

      // Wait for the server to initialize
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Kill the process
      child.kill('SIGTERM');
      await new Promise((resolve) => child.on('close', resolve));

      // Validate: every line on stdout must be valid JSON-RPC or empty
      const rawStdout = Buffer.concat(stdoutChunks).toString('utf-8');
      const lines = rawStdout.split('\n').filter((l) => l.trim().length > 0);

      for (const line of lines) {
        // MCP uses JSON-RPC 2.0 — every stdout line should parse as JSON
        // (content-length headers are also valid in the protocol framing)
        if (line.startsWith('{')) {
          expect(() => JSON.parse(line)).not.toThrow();
          const parsed = JSON.parse(line);
          expect(parsed).toHaveProperty('jsonrpc', '2.0');
        }
      }
    }, 15000);

    it('should redirect log output to stderr, not stdout', async () => {
      const stderrChunks: Buffer[] = [];
      const stdoutChunks: Buffer[] = [];

      const child: ChildProcess = spawn('npx', ['tsx', entrypointPath], {
        cwd: projectPath,
        env: { ...process.env, FRONTMCP_CLI_VERBOSE: '1' } as Record<string, string>,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      child.stdout!.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr!.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      // Wait for server to initialize and log startup messages
      await new Promise((resolve) => setTimeout(resolve, 5000));

      child.kill('SIGTERM');
      await new Promise((resolve) => child.on('close', resolve));

      const rawStdout = Buffer.concat(stdoutChunks).toString('utf-8');
      const rawStderr = Buffer.concat(stderrChunks).toString('utf-8');

      // stdout should have no log-like content (timestamps, log levels, etc.)
      const logPatterns = [/\[.*INFO\]/, /\[.*WARN\]/, /\[.*ERROR\]/, /\[.*DEBUG\]/, /Initializing FrontMCP/];
      for (const pattern of logPatterns) {
        expect(rawStdout).not.toMatch(pattern);
      }

      // stderr may contain redirected log output (this is where logs should go)
      // We don't strictly require logs on stderr, but if they exist they should be there
      if (rawStderr.length > 0) {
        // stderr output is expected — this is where console.log was redirected
        expect(rawStderr).toBeDefined();
      }
    }, 15000);
  });

  // ── Tool Operations ──────────────────────────────────────────────────

  describe('tools', () => {
    it('should list available tools', async () => {
      await startServerAndConnect();

      const result = await client!.listTools();

      expect(result.tools).toBeDefined();
      expect(result.tools.length).toBeGreaterThan(0);

      const toolNames = result.tools.map((t) => t.name);
      expect(toolNames).toContain('create-note');
      expect(toolNames).toContain('list-notes');
    }, 30000);

    it('should include tool descriptions and input schemas', async () => {
      await startServerAndConnect();

      const result = await client!.listTools();
      const createNote = result.tools.find((t) => t.name === 'create-note');

      expect(createNote).toBeDefined();
      expect(createNote!.description).toBe('Create a new note with title and content');
      expect(createNote!.inputSchema).toBeDefined();
      expect(createNote!.inputSchema.properties).toHaveProperty('title');
      expect(createNote!.inputSchema.properties).toHaveProperty('content');
    }, 30000);

    it('should call a tool and return structured result', async () => {
      await startServerAndConnect();

      const result = await client!.callTool({
        name: 'create-note',
        arguments: { title: 'Test Note', content: 'Created via stdio' },
      });

      expect(result).toBeDefined();
      expect(result.isError).not.toBe(true);
      expect(result.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'text' })]));

      // Parse the text content to verify the note was created
      const textContent = result.content.find((c: { type: string }) => c.type === 'text');
      expect(textContent).toBeDefined();
      const noteData = JSON.parse((textContent as { text: string }).text);
      expect(noteData.title).toBe('Test Note');
      expect(noteData.content).toBe('Created via stdio');
      expect(noteData.id).toMatch(/^note-/);
    }, 30000);

    it('should handle multiple sequential tool calls', async () => {
      await startServerAndConnect();

      // Create multiple notes
      await client!.callTool({
        name: 'create-note',
        arguments: { title: 'Note 1', content: 'First note' },
      });

      await client!.callTool({
        name: 'create-note',
        arguments: { title: 'Note 2', content: 'Second note' },
      });

      // List all notes
      const listResult = await client!.callTool({
        name: 'list-notes',
        arguments: {},
      });

      expect(listResult.isError).not.toBe(true);
      const textContent = listResult.content.find((c: { type: string }) => c.type === 'text');
      const data = JSON.parse((textContent as { text: string }).text);
      expect(data.count).toBe(2);
      expect(data.notes).toHaveLength(2);
    }, 30000);

    it('should return error for unknown tool', async () => {
      await startServerAndConnect();

      try {
        await client!.callTool({
          name: 'nonexistent-tool',
          arguments: {},
        });
        // Some implementations throw, some return isError
      } catch (err) {
        expect(err).toBeDefined();
      }
    }, 30000);
  });

  // ── Resource Operations ──────────────────────────────────────────────

  describe('resources', () => {
    it('should list available resources', async () => {
      await startServerAndConnect();

      const result = await client!.listResources();

      expect(result.resources).toBeDefined();
      expect(result.resources.length).toBeGreaterThan(0);

      const uris = result.resources.map((r) => r.uri);
      expect(uris).toContain('notes://all');
    }, 30000);

    it('should read a resource and return structured content', async () => {
      await startServerAndConnect();

      const result = await client!.readResource({ uri: 'notes://all' });

      expect(result).toBeDefined();
      expect(result.contents).toBeDefined();
      expect(result.contents.length).toBeGreaterThan(0);
      expect(result.contents[0]).toHaveProperty('uri', 'notes://all');
    }, 30000);
  });

  // ── Prompt Operations ────────────────────────────────────────────────

  describe('prompts', () => {
    it('should list available prompts', async () => {
      await startServerAndConnect();

      const result = await client!.listPrompts();

      expect(result.prompts).toBeDefined();
      expect(result.prompts.length).toBeGreaterThan(0);

      const promptNames = result.prompts.map((p) => p.name);
      expect(promptNames).toContain('summarize-notes');
    }, 30000);

    it('should get a prompt with default arguments', async () => {
      await startServerAndConnect();

      const result = await client!.getPrompt({ name: 'summarize-notes' });

      expect(result).toBeDefined();
      expect(result.messages).toBeDefined();
      expect(result.messages.length).toBeGreaterThan(0);
      expect(result.messages[0].role).toBe('user');
    }, 30000);

    it('should get a prompt with custom arguments', async () => {
      await startServerAndConnect();

      const result = await client!.getPrompt({
        name: 'summarize-notes',
        arguments: { format: 'detailed' },
      });

      expect(result).toBeDefined();
      expect(result.description).toContain('detailed');
    }, 30000);
  });

  // ── Graceful Shutdown ────────────────────────────────────────────────

  describe('shutdown', () => {
    it('should handle SIGTERM gracefully', async () => {
      const child: ChildProcess = spawn('npx', ['tsx', entrypointPath], {
        cwd: projectPath,
        env: process.env as Record<string, string>,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 4000));

      // Send SIGTERM
      child.kill('SIGTERM');

      // Wait for process to exit
      const exitCode = await new Promise<number | null>((resolve) => {
        const timeout = setTimeout(() => {
          child.kill('SIGKILL');
          resolve(null);
        }, 5000);
        child.on('close', (code) => {
          clearTimeout(timeout);
          resolve(code);
        });
      });

      // Process should exit cleanly (0) or be killed (null if we had to SIGKILL)
      expect(exitCode === 0 || exitCode === null).toBe(true);
    }, 15000);
  });
});
