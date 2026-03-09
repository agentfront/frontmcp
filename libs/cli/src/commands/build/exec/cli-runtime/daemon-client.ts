/**
 * Lightweight daemon client for CLI exec.
 *
 * Sends MCP JSON-RPC requests over a Unix socket using Node.js built-in http module.
 * This avoids the full FrontMCP SDK initialization (~420ms) by talking to an
 * already-running daemon process.
 *
 * NOTE: This file is used as a CJS runtime module — it gets bundled into the CLI
 * output by esbuild alongside the generated CLI entry. It must remain free of
 * TypeScript-only constructs at runtime (the .ts extension is for build-time only).
 */

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Generate the daemon-client JavaScript source code (CJS module).
 * This is embedded into the CLI bundle at build time.
 */
export function generateDaemonClientSource(): string {
  return `'use strict';

var http = require('http');

/**
 * Send a JSON-RPC request over a Unix socket.
 * @param {string} socketPath - Path to the Unix socket file.
 * @param {string} method - JSON-RPC method name.
 * @param {object} [params] - Method parameters.
 * @returns {Promise<object>} Parsed JSON-RPC result.
 */
function rpcCall(socketPath, method, params) {
  return new Promise(function(resolve, reject) {
    var body = JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: method,
      params: params || {}
    });

    var req = http.request({
      socketPath: socketPath,
      path: '/mcp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 10000
    }, function(res) {
      var chunks = [];
      res.on('data', function(chunk) { chunks.push(chunk); });
      res.on('end', function() {
        try {
          var json = JSON.parse(Buffer.concat(chunks).toString());
          if (json.error) {
            var err = new Error(json.error.message || 'RPC error');
            err.code = json.error.code;
            err.data = json.error.data;
            reject(err);
          } else {
            resolve(json.result);
          }
        } catch (e) {
          reject(new Error('Invalid JSON response from daemon'));
        }
      });
    });

    req.on('error', function(err) {
      reject(err);
    });

    req.on('timeout', function() {
      req.destroy();
      reject(new Error('Daemon request timed out'));
    });

    req.write(body);
    req.end();
  });
}

/**
 * Create a daemon client that implements the same interface as DirectClient.
 * @param {string} socketPath - Path to the Unix socket file.
 * @returns {object} Client object with MCP methods.
 */
function createDaemonClient(socketPath) {
  function call(method, params) {
    return rpcCall(socketPath, method, params);
  }

  return {
    ping: function() {
      return call('ping');
    },
    callTool: function(name, args) {
      return call('tools/call', { name: name, arguments: args || {} });
    },
    listTools: function() {
      return call('tools/list');
    },
    listResources: function() {
      return call('resources/list');
    },
    readResource: function(uri) {
      return call('resources/read', { uri: uri });
    },
    listResourceTemplates: function() {
      return call('resources/templates/list');
    },
    listPrompts: function() {
      return call('prompts/list');
    },
    getPrompt: function(name, args) {
      return call('prompts/get', { name: name, arguments: args || {} });
    },
    searchSkills: function(query) {
      return call('skills/search', { query: query || '' });
    },
    loadSkills: function(ids) {
      return call('skills/load', { ids: ids });
    },
    listSkills: function() {
      return call('skills/list');
    },
    listJobs: function() {
      return call('jobs/list');
    },
    executeJob: function(name, input, opts) {
      return call('jobs/execute', { name: name, input: input, options: opts });
    },
    getJobStatus: function(runId) {
      return call('jobs/status', { runId: runId });
    },
    listWorkflows: function() {
      return call('workflows/list');
    },
    executeWorkflow: function(name, input, opts) {
      return call('workflows/execute', { name: name, input: input, options: opts });
    },
    getWorkflowStatus: function(runId) {
      return call('workflows/status', { runId: runId });
    },
    subscribeResource: function(uri) {
      return call('resources/subscribe', { uri: uri });
    },
    unsubscribeResource: function(uri) {
      return call('resources/unsubscribe', { uri: uri });
    },
    onResourceUpdated: function() {
      console.warn('Resource subscriptions are not supported in daemon mode (HTTP-based, no push).');
      return function() {};
    },
    onNotification: function() {
      console.warn('Notifications are not supported in daemon mode (HTTP-based, no push).');
      return function() {};
    },
    close: function() {
      return Promise.resolve();
    }
  };
}

exports.createDaemonClient = createDaemonClient;
`;
}
