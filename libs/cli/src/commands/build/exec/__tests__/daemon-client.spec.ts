import { generateDaemonClientSource } from '../cli-runtime/daemon-client';

describe('generateDaemonClientSource', () => {
  let source: string;

  beforeAll(() => {
    source = generateDaemonClientSource();
  });

  it('should generate valid CJS module', () => {
    expect(source).toContain("'use strict'");
    expect(source).toContain('exports.createDaemonClient');
  });

  it('should use http module for Unix socket communication', () => {
    expect(source).toContain("require('http')");
    expect(source).toContain('socketPath');
  });

  it('should implement JSON-RPC protocol', () => {
    expect(source).toContain('jsonrpc');
    expect(source).toContain("'2.0'");
    expect(source).toContain('method');
  });

  it('should implement rpcCall function', () => {
    expect(source).toContain('function rpcCall(socketPath, method, params)');
    expect(source).toContain("path: '/mcp'");
    expect(source).toContain("method: 'POST'");
    expect(source).toContain("'Content-Type': 'application/json'");
  });

  it('should handle RPC errors', () => {
    expect(source).toContain('json.error');
    expect(source).toContain('RPC error');
  });

  it('should handle timeout', () => {
    expect(source).toContain('timeout: 10000');
    expect(source).toContain('Daemon request timed out');
  });

  it('should handle invalid JSON response', () => {
    expect(source).toContain('Invalid JSON response from daemon');
  });

  it('should implement createDaemonClient factory', () => {
    expect(source).toContain('function createDaemonClient(socketPath)');
  });

  describe('client methods', () => {
    it('should implement ping', () => {
      expect(source).toContain("ping: function()");
      expect(source).toContain("call('ping')");
    });

    it('should implement callTool', () => {
      expect(source).toContain("callTool: function(name, args)");
      expect(source).toContain("'tools/call'");
    });

    it('should implement listTools', () => {
      expect(source).toContain("listTools: function()");
      expect(source).toContain("'tools/list'");
    });

    it('should implement listResources', () => {
      expect(source).toContain("listResources: function()");
      expect(source).toContain("'resources/list'");
    });

    it('should implement readResource', () => {
      expect(source).toContain("readResource: function(uri)");
      expect(source).toContain("'resources/read'");
    });

    it('should implement listResourceTemplates', () => {
      expect(source).toContain("listResourceTemplates: function()");
      expect(source).toContain("'resources/templates/list'");
    });

    it('should implement listPrompts', () => {
      expect(source).toContain("listPrompts: function()");
      expect(source).toContain("'prompts/list'");
    });

    it('should implement getPrompt', () => {
      expect(source).toContain("getPrompt: function(name, args)");
      expect(source).toContain("'prompts/get'");
    });

    it('should implement searchSkills', () => {
      expect(source).toContain("searchSkills: function(query)");
      expect(source).toContain("'skills/search'");
    });

    it('should implement loadSkills', () => {
      expect(source).toContain("loadSkills: function(ids)");
      expect(source).toContain("'skills/load'");
    });

    it('should implement listSkills', () => {
      expect(source).toContain("listSkills: function()");
      expect(source).toContain("'skills/list'");
    });

    it('should implement listJobs', () => {
      expect(source).toContain("listJobs: function()");
      expect(source).toContain("'jobs/list'");
    });

    it('should implement executeJob', () => {
      expect(source).toContain("executeJob: function(name, input, opts)");
      expect(source).toContain("'jobs/execute'");
    });

    it('should implement getJobStatus', () => {
      expect(source).toContain("getJobStatus: function(runId)");
      expect(source).toContain("'jobs/status'");
    });

    it('should implement listWorkflows', () => {
      expect(source).toContain("listWorkflows: function()");
      expect(source).toContain("'workflows/list'");
    });

    it('should implement executeWorkflow', () => {
      expect(source).toContain("executeWorkflow: function(name, input, opts)");
      expect(source).toContain("'workflows/execute'");
    });

    it('should implement getWorkflowStatus', () => {
      expect(source).toContain("getWorkflowStatus: function(runId)");
      expect(source).toContain("'workflows/status'");
    });

    it('should implement subscribeResource', () => {
      expect(source).toContain("subscribeResource: function(uri)");
      expect(source).toContain("'resources/subscribe'");
    });

    it('should implement unsubscribeResource', () => {
      expect(source).toContain("unsubscribeResource: function(uri)");
      expect(source).toContain("'resources/unsubscribe'");
    });

    it('should implement close', () => {
      expect(source).toContain("close: function()");
      expect(source).toContain('Promise.resolve()');
    });
  });

  it('should be parseable as JavaScript', () => {
    // Verify the generated source is valid JS by creating a function from it
    expect(() => {
      // eslint-disable-next-line no-new-func
      new Function(source);
    }).not.toThrow();
  });
});
