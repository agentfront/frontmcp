/**
 * E2E Tests for Jobs via DirectClient
 *
 * Tests job and workflow operations using DirectClient convenience methods
 * connected via server.connect(). These methods internally call MCP tools
 * and parse the JSON result from text content.
 */

import { FrontMcpInstance, DirectMcpServer } from '@frontmcp/sdk';
import type { DirectClient } from '@frontmcp/sdk';
import { serverConfig } from '../src/config';

describe('Jobs DirectClient E2E', () => {
  let server: DirectMcpServer;
  let client: DirectClient;

  beforeEach(async () => {
    server = await FrontMcpInstance.createDirect(serverConfig);
    client = await server.connect({ session: { id: 'test-session' } });
  });

  afterEach(async () => {
    await client.close();
    await server.dispose();
  });

  describe('Job Operations via DirectClient', () => {
    it('should list jobs', async () => {
      const result = await client.listJobs();
      expect(result.jobs).toBeDefined();
      expect(result.count).toBeGreaterThanOrEqual(2);

      const names = result.jobs.map((j) => j.name);
      expect(names).toContain('greet');
      expect(names).toContain('analyze-text');
    });

    it('should execute job inline', async () => {
      const result = await client.executeJob('greet', { name: 'Alice' });
      expect(result.state).toBe('completed');
      expect(result.result).toEqual({ message: 'Hello, Alice!' });
    });

    it('should execute job in background', async () => {
      const result = await client.executeJob('analyze-text', { text: 'Hello world' }, { background: true });
      expect(result.runId).toBeDefined();
      expect(['pending', 'running', 'completed']).toContain(result.state);
    });

    it('should get job status', async () => {
      const exec = await client.executeJob('greet', { name: 'Bob' });
      const status = await client.getJobStatus(exec.runId);
      expect(status.state).toBe('completed');
      expect(status.jobName).toBe('greet');
    });

    it('should filter jobs by tags', async () => {
      const result = await client.listJobs({ tags: ['greeting'] });
      expect(result.jobs.length).toBeGreaterThanOrEqual(1);
      expect(result.jobs.every((j) => Array.isArray(j.tags) && j.tags.includes('greeting'))).toBe(true);
    });
  });

  describe('Workflow Operations via DirectClient', () => {
    it('should list workflows', async () => {
      const result = await client.listWorkflows();
      expect(result.workflows).toBeDefined();
      expect(result.count).toBeGreaterThanOrEqual(1);

      const names = result.workflows.map((w) => w.name);
      expect(names).toContain('greet-and-analyze');
    });

    it('should execute workflow inline', async () => {
      const result = await client.executeWorkflow('greet-and-analyze');
      expect(result.state).toBe('completed');
      expect(result.runId).toBeDefined();
    });

    it('should execute workflow in background', async () => {
      const result = await client.executeWorkflow('greet-and-analyze', undefined, { background: true });
      expect(result.runId).toBeDefined();
      expect(['pending', 'running', 'completed']).toContain(result.state);
    });

    it('should get workflow status', async () => {
      const exec = await client.executeWorkflow('greet-and-analyze');
      const status = await client.getWorkflowStatus(exec.runId);
      expect(status.state).toBe('completed');
      expect(status.workflowName).toBe('greet-and-analyze');
      expect(status.stepResults).toBeDefined();
    });
  });

  describe('Error handling', () => {
    it('should reject when executing a non-existent job', async () => {
      await expect(client.executeJob('does-not-exist', {})).rejects.toThrow();
    });

    it('should reject when executing a non-existent workflow', async () => {
      await expect(client.executeWorkflow('does-not-exist')).rejects.toThrow();
    });

    it('should reject when getting status for an unknown job runId', async () => {
      await expect(client.getJobStatus('unknown-run-id')).rejects.toThrow();
    });

    it('should reject when getting status for an unknown workflow runId', async () => {
      await expect(client.getWorkflowStatus('unknown-run-id')).rejects.toThrow();
    });
  });

  describe('Jobs appear in tool listing', () => {
    it('should include job management tools in listTools', async () => {
      const tools = await client.listTools();
      const toolNames = (tools as Array<{ name: string }>).map((t) => t.name);
      expect(toolNames).toContain('execute-job');
      expect(toolNames).toContain('get-job-status');
    });
  });
});
