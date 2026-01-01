import type { DashboardPluginOptions } from '../dashboard.types';

/**
 * Escape a string for safe interpolation into JavaScript string literals.
 * Prevents XSS by escaping quotes, backslashes, and script-closing sequences.
 */
function escapeForJs(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/</g, '\\x3c')
    .replace(/>/g, '\\x3e')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/**
 * Generate the dashboard HTML page that loads UI from CDN and connects via MCP.
 *
 * The UI connects to the dashboard SSE endpoint and uses MCP protocol to:
 * - Call dashboard:graph tool to get graph data
 * - Receive real-time notifications
 */
export function generateDashboardHtml(options: DashboardPluginOptions): string {
  const cdn = options.cdn;
  const basePath = options.basePath;

  // Check if custom entrypoint is provided (external UI bundle)
  if (cdn.entrypoint) {
    return generateExternalEntrypointHtml(options);
  }

  // Generate inline dashboard UI
  return generateInlineDashboardHtml(options);
}

/**
 * Generate HTML that loads dashboard from an external CDN entrypoint.
 */
function generateExternalEntrypointHtml(options: DashboardPluginOptions): string {
  const { cdn, basePath, auth } = options;
  const token = escapeForJs(auth?.token || '');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FrontMCP Dashboard</title>
  <script type="importmap">
  {
    "imports": {
      "react": "${cdn.react}",
      "react-dom": "${cdn.reactDom}",
      "react-dom/client": "${cdn.reactDomClient}",
      "react/jsx-runtime": "${cdn.reactJsxRuntime}",
      "@xyflow/react": "${cdn.xyflow}",
      "dagre": "${cdn.dagre}"
    }
  }
  </script>
  <link rel="stylesheet" href="${cdn.xyflowCss}" />
</head>
<body>
  <div id="root">Loading dashboard...</div>
  <script type="module">
    // Dashboard configuration
    window.__FRONTMCP_DASHBOARD__ = {
      basePath: '${basePath}',
      sseUrl: '${basePath}/sse${token ? `?token=${token}` : ''}',
      token: '${token}',
    };

    // Load external dashboard UI
    import('${cdn.entrypoint}').then(mod => {
      if (mod.mount) {
        mod.mount(document.getElementById('root'), window.__FRONTMCP_DASHBOARD__);
      }
    }).catch(err => {
      document.getElementById('root').innerHTML =
        '<div style="color: red; padding: 20px;">Failed to load dashboard: ' + err.message + '</div>';
    });
  </script>
</body>
</html>`;
}

/**
 * Generate inline dashboard HTML with embedded React app.
 * Uses MCP protocol via SSE to fetch data from dashboard:graph tool.
 */
function generateInlineDashboardHtml(options: DashboardPluginOptions): string {
  const { cdn, basePath, auth } = options;
  const token = escapeForJs(auth?.token || '');
  const sseUrl = `${basePath}/sse${token ? `?token=${token}` : ''}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FrontMCP Dashboard</title>

  <script type="importmap">
  {
    "imports": {
      "react": "${cdn.react}",
      "react-dom": "${cdn.reactDom}",
      "react-dom/client": "${cdn.reactDomClient}",
      "react/jsx-runtime": "${cdn.reactJsxRuntime}",
      "@xyflow/react": "${cdn.xyflow}",
      "dagre": "${cdn.dagre}"
    }
  }
  </script>
  <link rel="stylesheet" href="${cdn.xyflowCss}" />

  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
    }
    #root { width: 100vw; height: 100vh; }

    .loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      gap: 16px;
    }
    .loading-spinner {
      width: 40px;
      height: 40px;
      border: 3px solid #334155;
      border-top-color: #3b82f6;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .error {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      gap: 12px;
      color: #f87171;
    }

    .header {
      position: fixed;
      top: 20px;
      left: 20px;
      background: #1e293b;
      padding: 16px 20px;
      border-radius: 12px;
      border: 1px solid #334155;
      z-index: 1000;
    }
    .header h1 {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .header .stats {
      font-size: 13px;
      color: #94a3b8;
    }
    .header .status {
      font-size: 11px;
      margin-top: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #22c55e;
    }
    .status-dot.disconnected { background: #ef4444; }
    .status-dot.connecting { background: #f59e0b; animation: pulse 1s ease-in-out infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

    .legend {
      position: fixed;
      bottom: 20px;
      left: 20px;
      background: #1e293b;
      padding: 16px;
      border-radius: 12px;
      border: 1px solid #334155;
      z-index: 1000;
      font-size: 12px;
    }
    .legend h3 {
      margin-bottom: 12px;
      font-size: 13px;
      color: #f1f5f9;
    }
    .legend-item {
      display: flex;
      align-items: center;
      margin-bottom: 6px;
      color: #94a3b8;
    }
    .legend-color {
      width: 16px;
      height: 16px;
      border-radius: 4px;
      margin-right: 8px;
      border: 2px solid;
    }

    .custom-node {
      padding: 10px 14px;
      border-radius: 8px;
      min-width: 140px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    .custom-node .node-type {
      font-size: 10px;
      text-transform: uppercase;
      margin-bottom: 4px;
      font-weight: 500;
      letter-spacing: 0.5px;
    }
    .custom-node .node-label {
      font-size: 13px;
      font-weight: 600;
      color: #f1f5f9;
    }
    .custom-node .node-desc {
      font-size: 10px;
      color: #94a3b8;
      margin-top: 3px;
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .react-flow__minimap { background: #1e293b !important; }
    .react-flow__controls button {
      background: #1e293b !important;
      border-color: #334155 !important;
      color: #e2e8f0 !important;
    }
    .react-flow__controls button:hover {
      background: #334155 !important;
    }
  </style>
</head>
<body>
  <div id="root">
    <div class="loading">
      <div class="loading-spinner"></div>
      <div>Connecting to server...</div>
    </div>
  </div>

  <script type="module">
    import React, { useMemo, useCallback, useState, useEffect } from 'react';
    import { createRoot } from 'react-dom/client';
    import {
      ReactFlow,
      ReactFlowProvider,
      Background,
      Controls,
      MiniMap,
      useNodesState,
      useEdgesState,
      Handle,
      Position
    } from '@xyflow/react';
    import dagre from 'dagre';

    // Configuration
    const config = {
      basePath: '${basePath}',
      sseUrl: '${sseUrl}',
      token: '${token}',
    };

    // Node styling config
    const nodeConfig = {
      server: { fill: '#312e81', stroke: '#6366f1', icon: '🖥️', textColor: '#a5b4fc' },
      scope: { fill: '#1e3a5f', stroke: '#3b82f6', icon: '📦', textColor: '#93c5fd' },
      app: { fill: '#14532d', stroke: '#22c55e', icon: '📱', textColor: '#86efac' },
      plugin: { fill: '#713f12', stroke: '#f59e0b', icon: '🔌', textColor: '#fcd34d' },
      adapter: { fill: '#7f1d1d', stroke: '#ef4444', icon: '🔗', textColor: '#fca5a5' },
      tool: { fill: '#164e63', stroke: '#06b6d4', icon: '🔧', textColor: '#67e8f9' },
      resource: { fill: '#312e81', stroke: '#8b5cf6', icon: '📄', textColor: '#c4b5fd' },
      'resource-template': { fill: '#4c1d95', stroke: '#a78bfa', icon: '📋', textColor: '#ddd6fe' },
      prompt: { fill: '#831843', stroke: '#ec4899', icon: '💬', textColor: '#f9a8d4' },
      auth: { fill: '#78350f', stroke: '#d97706', icon: '🛡️', textColor: '#fcd34d' },
    };

    // Custom node component
    function CustomNode({ data, type }) {
      const cfg = nodeConfig[type] || nodeConfig.tool;

      return React.createElement('div', {
        className: 'custom-node',
        style: { background: cfg.fill, border: '2px solid ' + cfg.stroke }
      },
        React.createElement(Handle, { type: 'target', position: Position.Top, style: { visibility: 'hidden' } }),
        React.createElement('div', { className: 'node-type', style: { color: cfg.textColor } },
          cfg.icon + ' ' + type
        ),
        React.createElement('div', { className: 'node-label' }, data.label),
        data.description && React.createElement('div', { className: 'node-desc' }, data.description),
        React.createElement(Handle, { type: 'source', position: Position.Bottom, style: { visibility: 'hidden' } })
      );
    }

    // Create node types
    const nodeTypes = {};
    Object.keys(nodeConfig).forEach(type => {
      nodeTypes[type] = (props) => CustomNode({ ...props, type });
    });

    // Layout with Dagre
    function layoutGraph(graphData) {
      const g = new dagre.graphlib.Graph();
      g.setGraph({ rankdir: 'TB', nodesep: 50, ranksep: 80 });
      g.setDefaultEdgeLabel(() => ({}));

      graphData.nodes.forEach(node => {
        g.setNode(node.id, { width: 160, height: 60 });
      });

      graphData.edges.forEach(edge => {
        g.setEdge(edge.source, edge.target);
      });

      dagre.layout(g);

      const nodes = graphData.nodes.map(node => {
        const pos = g.node(node.id);
        return {
          id: node.id,
          type: node.type,
          position: { x: pos.x - 80, y: pos.y - 30 },
          data: { label: node.label, ...node.data },
        };
      });

      const edges = graphData.edges.map(edge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'smoothstep',
        style: { stroke: '#475569', strokeWidth: 1.5 },
        markerEnd: { type: 'arrowclosed', color: '#475569' },
      }));

      return { nodes, edges };
    }

    /**
     * MCP Client for SSE transport communication.
     * Connects to the dashboard SSE endpoint and sends JSON-RPC requests.
     */
    class McpClient {
      constructor(sseUrl, basePath) {
        this.sseUrl = sseUrl;
        this.basePath = basePath;
        this.messageUrl = null;
        this.eventSource = null;
        this.requestId = 0;
        this.pendingRequests = new Map();
        this.sessionId = null;
      }

      /**
       * Connect to the SSE endpoint and wait for the message endpoint URL.
       * The server sends an 'endpoint' event containing the URL for POST requests.
       */
      async connect() {
        return new Promise((resolve, reject) => {
          this.eventSource = new EventSource(this.sseUrl);

          // Listen for the endpoint event to get the message URL
          this.eventSource.addEventListener('endpoint', (e) => {
            const endpointPath = e.data.split('?')[0].replace(this.basePath, '');
            this.messageUrl = this.basePath + endpointPath;

            // Extract sessionId from the endpoint URL (legacy SSE format)
            const match = e.data.match(/sessionId=([^&]+)/);
            this.sessionId = match ? match[1] : null;
            resolve();
          });

          // Listen for responses to our requests
          this.eventSource.addEventListener('message', (e) => {
            try {
              const response = JSON.parse(e.data);
              if (response.id && this.pendingRequests.has(response.id)) {
                const { resolve, reject } = this.pendingRequests.get(response.id);
                this.pendingRequests.delete(response.id);
                if (response.error) {
                  reject(new Error(response.error.message));
                } else {
                  resolve(response.result);
                }
              }
            } catch (err) {
              console.error('Failed to parse SSE message:', err);
            }
          });

          this.eventSource.onerror = () => {
            if (!this.messageUrl) {
              reject(new Error('SSE connection failed'));
            }
          };

          // Connection timeout
          setTimeout(() => {
            if (!this.messageUrl) {
              this.close();
              reject(new Error('SSE connection timeout'));
            }
          }, 10000);
        });
      }

      /**
       * Call an MCP tool via JSON-RPC over HTTP POST.
       * @param {string} name - The tool name (e.g., 'dashboard:graph')
       * @param {object} args - The tool arguments
       * @returns {Promise<object>} The tool result
       */
      async callTool(name, args = {}) {
        if (!this.messageUrl) {
          throw new Error('Not connected');
        }

        const id = ++this.requestId;
        const message = {
          jsonrpc: '2.0',
          id,
          method: 'tools/call',
          params: { name, arguments: args }
        };

        return new Promise((resolve, reject) => {
          this.pendingRequests.set(id, { resolve, reject });

          // Append sessionId to URL for legacy SSE transport
          const url = this.messageUrl + (this.sessionId ? '?sessionId=' + this.sessionId : '');
          fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message)
          }).catch(reject);
        });
      }

      /** Close the SSE connection */
      close() {
        if (this.eventSource) {
          this.eventSource.close();
          this.eventSource = null;
        }
      }
    }

    // Main App
    function DashboardApp() {
      const [status, setStatus] = useState('loading');
      const [error, setError] = useState(null);
      const [graphData, setGraphData] = useState(null);
      const [nodes, setNodes, onNodesChange] = useNodesState([]);
      const [edges, setEdges, onEdgesChange] = useEdgesState([]);

      useEffect(() => {
        const client = new McpClient(config.sseUrl, config.basePath);

        async function init() {
          try {
            // Connect via SSE
            setStatus('connecting');
            await client.connect();

            // Call dashboard:graph tool via MCP protocol
            const result = await client.callTool('dashboard:graph', {});

            // Extract graph data from tool result
            let data;
            if (result && result.content && result.content[0]) {
              const content = result.content[0];
              if (content.type === 'text') {
                data = JSON.parse(content.text);
              }
            }

            if (!data) {
              throw new Error('Invalid graph data response');
            }

            setGraphData(data);
            setStatus('connected');

            const { nodes: layoutNodes, edges: layoutEdges } = layoutGraph(data);
            setNodes(layoutNodes);
            setEdges(layoutEdges);
          } catch (err) {
            setStatus('error');
            setError(err.message);
          }
        }

        init();

        return () => client.close();
      }, []);

      if (error) {
        return React.createElement('div', { className: 'error' },
          React.createElement('div', { style: { fontSize: 48 } }, '⚠️'),
          React.createElement('div', { style: { fontSize: 18, fontWeight: 600 } }, 'Connection Failed'),
          React.createElement('div', { style: { color: '#94a3b8' } }, error)
        );
      }

      if (!graphData) {
        return React.createElement('div', { className: 'loading' },
          React.createElement('div', { className: 'loading-spinner' }),
          React.createElement('div', null, 'Loading graph data...')
        );
      }

      return React.createElement('div', { style: { width: '100%', height: '100%' } },
        React.createElement('div', { className: 'header' },
          React.createElement('h1', null, graphData.metadata.serverName),
          React.createElement('div', { className: 'stats' },
            graphData.metadata.nodeCount + ' nodes · ' + graphData.metadata.edgeCount + ' edges'
          ),
          React.createElement('div', { className: 'status' },
            React.createElement('span', {
              className: 'status-dot' + (status !== 'connected' ? ' ' + status : '')
            }),
            status === 'connected' ? 'Connected' : status
          )
        ),

        React.createElement('div', { className: 'legend' },
          React.createElement('h3', null, 'Node Types'),
          ...Object.entries(nodeConfig).slice(0, 6).map(([type, cfg]) =>
            React.createElement('div', { key: type, className: 'legend-item' },
              React.createElement('div', {
                className: 'legend-color',
                style: { background: cfg.fill, borderColor: cfg.stroke }
              }),
              cfg.icon + ' ' + type
            )
          )
        ),

        React.createElement(ReactFlow, {
          nodes,
          edges,
          onNodesChange,
          onEdgesChange,
          nodeTypes,
          fitView: true,
          fitViewOptions: { padding: 0.2 },
          minZoom: 0.1,
          maxZoom: 2,
        },
          React.createElement(Background, { color: '#334155', gap: 20 }),
          React.createElement(Controls),
          React.createElement(MiniMap, {
            nodeColor: (n) => nodeConfig[n.type]?.stroke || '#475569',
            maskColor: 'rgba(15, 23, 42, 0.8)'
          })
        )
      );
    }

    // Mount
    const root = createRoot(document.getElementById('root'));
    root.render(
      React.createElement(ReactFlowProvider, null,
        React.createElement(DashboardApp)
      )
    );
  </script>
</body>
</html>`;
}
