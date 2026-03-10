/**
 * E2E Tests for Jobs via Direct Server API
 *
 * Tests job and workflow operations using FrontMcpInstance.createDirect().
 * Jobs are exposed as standard MCP tools (list-jobs, execute-job, etc.).
 */

import { FrontMcpInstance, DirectMcpServer } from '@frontmcp/sdk';
import { serverConfig } from '../src/config';

describe('Jobs Direct E2E', () => {
  let server: DirectMcpServer;

  beforeEach(async () => {
    server = await FrontMcpInstance.createDirect(serverConfig);
  });

  afterEach(async () => {
    await server.dispose();
  });

  describe('Job MCP Tools via callTool', () => {
    it('should list jobs via list-jobs tool', async () => {
      const result = await server.callTool('list-jobs', {});
      expect(result.isError).not.toBe(true);

      const text = (result.content as Array<{ type: string; text?: string }>)?.find((c) => c.type === 'text')?.text;
      expect(result.isError).not.toBe(true);
      expect(text).toBeDefined();
      const data = JSON.parse(text!);
      expect(data.jobs).toBeDefined();
      expect(data.jobs.length).toBeGreaterThanOrEqual(2);

      const names = data.jobs.map((j: { name: string }) => j.name);
      expect(names).toContain('greet');
      expect(names).toContain('analyze-text');
    });

    it('should execute a job inline', async () => {
      const result = await server.callTool('execute-job', {
        name: 'greet',
        input: { name: 'Alice' },
        background: false,
      });
      expect(result.isError).not.toBe(true);

      const text = (result.content as Array<{ type: string; text?: string }>)?.find((c) => c.type === 'text')?.text;
      expect(result.isError).not.toBe(true);
      expect(text).toBeDefined();
      const data = JSON.parse(text!);
      expect(data.result).toEqual({ message: 'Hello, Alice!' });
      expect(data.state).toBe('completed');
    });

    it('should execute a job in background', async () => {
      const result = await server.callTool('execute-job', {
        name: 'analyze-text',
        input: { text: 'Hello world test' },
        background: true,
      });
      expect(result.isError).not.toBe(true);

      const text = (result.content as Array<{ type: string; text?: string }>)?.find((c) => c.type === 'text')?.text;
      expect(result.isError).not.toBe(true);
      expect(text).toBeDefined();
      const data = JSON.parse(text!);
      expect(data.runId).toBeDefined();
    });

    it('should get job status', async () => {
      // Execute inline first to get a completed run
      const execResult = await server.callTool('execute-job', {
        name: 'greet',
        input: { name: 'Bob' },
        background: false,
      });
      expect(execResult.isError).not.toBe(true);
      const execText = (execResult.content as Array<{ type: string; text?: string }>)?.find(
        (c) => c.type === 'text',
      )?.text;
      expect(execText).toBeDefined();
      const execData = JSON.parse(execText!);

      const statusResult = await server.callTool('get-job-status', {
        runId: execData.runId,
      });
      expect(statusResult.isError).not.toBe(true);

      const statusText = (statusResult.content as Array<{ type: string; text?: string }>)?.find(
        (c) => c.type === 'text',
      )?.text;
      expect(statusText).toBeDefined();
      const statusData = JSON.parse(statusText!);
      expect(statusData.state).toBe('completed');
    });
  });

  describe('Job convenience methods', () => {
    it('should list jobs via convenience method', async () => {
      const result = await server.listJobs();
      expect(result.isError).not.toBe(true);
    });

    it('should execute job via convenience method', async () => {
      const result = await server.executeJob('greet', { name: 'Test' });
      expect(result.isError).not.toBe(true);
    });

    it('should get job status via convenience method', async () => {
      const execResult = await server.executeJob('greet', { name: 'StatusTest' });
      expect(execResult.isError).not.toBe(true);
      const execText = (execResult.content as Array<{ type: string; text?: string }>)?.find(
        (c) => c.type === 'text',
      )?.text;
      expect(execText).toBeDefined();
      const execData = JSON.parse(execText!);

      const statusResult = await server.getJobStatus(execData.runId);
      expect(statusResult.isError).not.toBe(true);
    });
  });

  describe('Workflow MCP Tools via callTool', () => {
    it('should list workflows', async () => {
      const result = await server.callTool('list-workflows', {});
      expect(result.isError).not.toBe(true);

      const text = (result.content as Array<{ type: string; text?: string }>)?.find((c) => c.type === 'text')?.text;
      expect(result.isError).not.toBe(true);
      expect(text).toBeDefined();
      const data = JSON.parse(text!);
      expect(data.workflows).toBeDefined();

      const names = data.workflows.map((w: { name: string }) => w.name);
      expect(names).toContain('greet-and-analyze');
    });

    it('should execute workflow inline', async () => {
      const result = await server.callTool('execute-workflow', {
        name: 'greet-and-analyze',
        background: false,
      });
      expect(result.isError).not.toBe(true);

      const text = (result.content as Array<{ type: string; text?: string }>)?.find((c) => c.type === 'text')?.text;
      expect(result.isError).not.toBe(true);
      expect(text).toBeDefined();
      const data = JSON.parse(text!);
      expect(data.state).toBe('completed');
    });
  });

  describe('Workflow convenience methods', () => {
    it('should list workflows via convenience method', async () => {
      const result = await server.listWorkflows();
      expect(result.isError).not.toBe(true);
    });

    it('should execute workflow via convenience method', async () => {
      const result = await server.executeWorkflow('greet-and-analyze');
      expect(result.isError).not.toBe(true);
    });
  });
});
