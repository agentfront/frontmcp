/**
 * Lightweight daemon client for CLI exec.
 *
 * Talks MCP streamable HTTP to the daemon over its Unix socket with Node's built-in http module, so a command skips
 * loading and starting the server in-process. It serves the methods the generated CLI calls, with the results the
 * in-process `connect()` client returns, and answers the questions (`elicitation/create`) the server asks during a call.
 *
 * NOTE: This file is used as a CJS runtime module — it gets bundled into the CLI
 * output by esbuild alongside the generated CLI entry. It must remain free of
 * TypeScript-only constructs at runtime (the .ts extension is for build-time only).
 */

/**
 * Generate the daemon-client JavaScript source code (CJS module).
 * This is embedded into the CLI bundle at build time.
 */
export function generateDaemonClientSource(): string {
  return `'use strict';

var http = require('http');

var PROTOCOL_VERSION = '2025-11-25';
var CLIENT_INFO = { name: 'mcp-client', version: '1.0.0' };
var REQUEST_TIMEOUT_MS = 60000;

function eventMessage(event) {
  var data = event.split(/\\r?\\n/)
    .filter(function(line) { return line.indexOf('data:') === 0; })
    .map(function(line) { return line.slice(5).trim(); })
    .join('\\n');
  if (!data) return undefined;
  try { return JSON.parse(data); } catch (_) { return undefined; }
}

// Read as it streams: a request the server sends during a call is answered before the call can end
function sendHttp(target, method, headers, body, onServerRequest) {
  return new Promise(function(resolve, reject) {
    var req = http.request({
      socketPath: target.socketPath,
      path: target.path,
      method: method,
      headers: headers,
      timeout: REQUEST_TIMEOUT_MS
    }, function(res) {
      res.setEncoding('utf8');
      var isEventStream = (res.headers['content-type'] || '').indexOf('text/event-stream') !== -1;
      var unread = '';
      var messages = [];
      function takeEvents(events) {
        events.map(eventMessage).filter(Boolean).forEach(function(message) {
          messages.push(message);
          if (message.method && message.id !== undefined && onServerRequest) {
            // The server waits for the user's answer: no timeout while it is asked
            req.setTimeout(0);
            onServerRequest(message).then(function() { req.setTimeout(REQUEST_TIMEOUT_MS); }, function(err) { req.destroy(err); });
          }
        });
      }
      res.on('data', function(chunk) {
        unread += chunk;
        if (!isEventStream) return;
        var events = unread.split(/\\r?\\n\\r?\\n/);
        unread = events.pop();
        takeEvents(events);
      });
      res.on('end', function() {
        if (isEventStream) takeEvents([unread]);
        else { try { messages.push(JSON.parse(unread)); } catch (_) { /* not JSON-RPC: reported by status */ } }
        resolve({ status: res.statusCode, sessionId: res.headers['mcp-session-id'], messages: messages });
      });
    });
    req.on('error', reject);
    req.on('timeout', function() {
      req.destroy(new Error('Daemon request timed out'));
    });
    req.end(body);
  });
}

function responseMessage(response, id) {
  var message = response.messages.find(function(m) { return m && m.id === id && !m.method; });
  if (!message) throw new Error('the daemon answered HTTP ' + response.status);
  if (message.error) {
    var err = new Error(message.error.message || 'RPC error');
    err.code = message.error.code;
    err.data = message.error.data;
    throw err;
  }
  return message.result;
}

/**
 * Create a daemon client that serves the methods the generated CLI calls, as the in-process client does.
 * @param {string} socketPath - Path to the Unix socket file.
 * @param {{ authToken?: string, entryPath?: string, onElicitation?: Function }} [options] - authToken is sent as a
 *   Bearer token with every request; entryPath is the MCP endpoint path the daemon serves (the server's
 *   http.entryPath, '/' by default); onElicitation answers the server's questions, as connect()'s does.
 * @returns {object} Client object with MCP methods; call connect() before the others.
 */
function createDaemonClient(socketPath, options) {
  var target = { socketPath: socketPath, path: (options && options.entryPath) || '/' };
  var authToken = options && options.authToken;
  var onElicitation = options && options.onElicitation;
  var sessionId;
  var lastId = 0;

  function headersFor(body) {
    var headers = { 'Accept': 'application/json, text/event-stream' };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
    if (sessionId) {
      headers['Mcp-Session-Id'] = sessionId;
      headers['Mcp-Protocol-Version'] = PROTOCOL_VERSION;
    }
    return headers;
  }

  function call(method, params) {
    lastId += 1;
    var id = lastId;
    var body = JSON.stringify({ jsonrpc: '2.0', id: id, method: method, params: params || {} });
    return sendHttp(target, 'POST', headersFor(body), body, answerServerRequest).then(function(response) {
      if (response.sessionId) sessionId = response.sessionId;
      return responseMessage(response, id);
    });
  }

  function answerServerRequest(message) {
    var reply = message.method === 'elicitation/create' && onElicitation
      ? Promise.resolve(onElicitation(Object.assign({ mode: 'form' }, message.params)))
          .catch(function() { return { action: 'decline' }; })
          .then(function(result) { return { jsonrpc: '2.0', id: message.id, result: result }; })
      : Promise.resolve({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found: ' + message.method } });
    return reply.then(function(answer) {
      var body = JSON.stringify(answer);
      return sendHttp(target, 'POST', headersFor(body), body);
    });
  }

  function notify(method) {
    var body = JSON.stringify({ jsonrpc: '2.0', method: method });
    return sendHttp(target, 'POST', headersFor(body), body).then(function(response) {
      if (response.status >= 400) throw new Error('the daemon answered HTTP ' + response.status);
    });
  }

  function listAll(method, key) {
    var items = [];
    function page(cursor) {
      return call(method, cursor ? { cursor: cursor } : {}).then(function(result) {
        items = items.concat(result[key] || []);
        if (result.nextCursor) return page(result.nextCursor);
        var all = {};
        all[key] = items;
        return all;
      });
    }
    return page();
  }

  function callToolJson(name, args) {
    return call('tools/call', { name: name, arguments: args }).then(function(result) {
      var text = (result.content || []).find(function(c) { return c.type === 'text'; });
      if (!text || !text.text) throw new Error('No text content from ' + name);
      return JSON.parse(text.text);
    });
  }

  return {
    _isDaemon: true,
    connect: function() {
      var capabilities = onElicitation ? { elicitation: { form: {} } } : {};
      return call('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: capabilities, clientInfo: CLIENT_INFO })
        .then(function() { return notify('notifications/initialized'); });
    },
    callTool: function(name, args) {
      return call('tools/call', { name: name, arguments: args || {} });
    },
    listResources: function() {
      return listAll('resources/list', 'resources');
    },
    readResource: function(uri) {
      return call('resources/read', { uri: uri });
    },
    listResourceTemplates: function() {
      return listAll('resources/templates/list', 'resourceTemplates');
    },
    listPrompts: function() {
      return listAll('prompts/list', 'prompts');
    },
    getPrompt: function(name, args) {
      return call('prompts/get', { name: name, arguments: args });
    },
    searchSkills: function(query) {
      return call('skills/search', { query: query });
    },
    loadSkills: function(ids, options) {
      return call('skills/load', Object.assign({ skillIds: ids }, options));
    },
    listSkills: function() {
      return call('skills/list');
    },
    listJobs: function() {
      return callToolJson('list_jobs', {});
    },
    executeJob: function(name, input, opts) {
      return callToolJson('execute_job', { name: name, input: input || {}, background: !!(opts && opts.background) });
    },
    getJobStatus: function(runId) {
      return callToolJson('get_job_status', { runId: runId });
    },
    listWorkflows: function() {
      return callToolJson('list_workflows', {});
    },
    executeWorkflow: function(name, input, opts) {
      return callToolJson('execute_workflow', { name: name, input: input || {}, background: !!(opts && opts.background) });
    },
    getWorkflowStatus: function(runId) {
      return callToolJson('get_workflow_status', { runId: runId });
    },
    close: function() {
      if (!sessionId) return Promise.resolve();
      return sendHttp(target, 'DELETE', headersFor()).then(function() {}, function() {});
    }
  };
}

exports.createDaemonClient = createDaemonClient;
`;
}
