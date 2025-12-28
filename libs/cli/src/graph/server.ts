/**
 * Dev server for graph visualization.
 * Serves a React Flow-based UI for visualizing the MCP server structure.
 */

import * as http from 'http';
import { c } from '../colors';
import type { GraphData } from './types';

interface ServerOptions {
  port: number;
  open: boolean;
}

/**
 * Start the graph visualization dev server.
 */
export async function startGraphServer(graphData: GraphData, options: ServerOptions): Promise<void> {
  const { port, open } = options;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);

    if (url.pathname === '/api/graph') {
      // Return graph data as JSON
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(graphData));
      return;
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      // Serve the main HTML page
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(generateHtml(graphData));
      return;
    }

    // 404 for other paths
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  return new Promise((resolve, reject) => {
    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`${c('red', 'Error:')} Port ${port} is already in use.`);
        console.error(`Try using a different port with --port <number>`);
        reject(error);
      } else {
        reject(error);
      }
    });

    server.listen(port, () => {
      const url = `http://localhost:${port}`;
      console.log('');
      console.log(`${c('cyan', '[graph]')} Server running at ${c('bold', url)}`);
      console.log('');
      console.log(`  ${c('gray', 'Nodes:')} ${graphData.metadata.nodeCount}`);
      console.log(`  ${c('gray', 'Edges:')} ${graphData.metadata.edgeCount}`);
      console.log('');
      console.log(`${c('gray', 'hint:')} press Ctrl+C to stop`);

      if (open) {
        openBrowser(url);
      }
    });

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log(`\n${c('gray', '[graph]')} shutting down...`);
      server.close();
      resolve();
      process.exit(0);
    });
  });
}

/**
 * Open URL in default browser.
 */
function openBrowser(url: string): void {
  const { platform } = process;
  const { spawn } = require('child_process');

  let command: string;
  let args: string[];

  if (platform === 'darwin') {
    command = 'open';
    args = [url];
  } else if (platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  spawn(command, args, { stdio: 'ignore', detached: true }).unref();
}

/**
 * Generate the HTML page with React Flow visualization via ESM.sh.
 * Uses React 19 and @xyflow/react loaded as ES modules - no build step required.
 */
function generateHtml(graphData: GraphData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FrontMCP Graph - ${graphData.metadata.serverName}</title>

  <!-- ESM.sh Import Map for React 19 + React Flow -->
  <script type="importmap">
  {
    "imports": {
      "react": "https://esm.sh/react@19",
      "react-dom": "https://esm.sh/react-dom@19",
      "react-dom/client": "https://esm.sh/react-dom@19/client",
      "react/jsx-runtime": "https://esm.sh/react@19/jsx-runtime",
      "@xyflow/react": "https://esm.sh/@xyflow/react@12?external=react,react-dom",
      "dagre": "https://esm.sh/dagre@0.8.5"
    }
  }
  </script>

  <!-- React Flow CSS -->
  <link rel="stylesheet" href="https://esm.sh/@xyflow/react@12/dist/style.css" />

  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    #root {
      width: 100vw;
      height: 100vh;
    }

    /* Header overlay */
    .header {
      position: fixed;
      top: 20px;
      left: 20px;
      background: white;
      padding: 16px 20px;
      border-radius: 12px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      z-index: 1000;
    }
    .header h1 {
      font-size: 20px;
      margin-bottom: 4px;
      color: #1f2937;
    }
    .header .stats {
      font-size: 13px;
      color: #6b7280;
    }

    /* Legend overlay */
    .legend {
      position: fixed;
      bottom: 20px;
      left: 20px;
      background: white;
      padding: 16px;
      border-radius: 12px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      z-index: 1000;
      font-size: 12px;
    }
    .legend h3 {
      margin-bottom: 12px;
      font-size: 14px;
      color: #1f2937;
    }
    .legend-item {
      display: flex;
      align-items: center;
      margin-bottom: 6px;
      color: #4b5563;
    }
    .legend-color {
      width: 18px;
      height: 18px;
      border-radius: 4px;
      margin-right: 10px;
      border: 2px solid;
    }

    /* Custom node styles - improved readability */
    .custom-node {
      padding: 12px 16px;
      border-radius: 10px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-width: 180px;
      box-shadow: 0 3px 10px rgba(0,0,0,0.12);
      background: white;
    }
    .custom-node .node-type {
      font-size: 11px;
      text-transform: uppercase;
      margin-bottom: 6px;
      font-weight: 500;
      letter-spacing: 0.5px;
    }
    .custom-node .node-label {
      font-size: 14px;
      font-weight: 600;
      color: #1f2937;
      line-height: 1.3;
    }
    .custom-node .node-desc {
      font-size: 11px;
      color: #6b7280;
      margin-top: 4px;
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    /* Auth node - shield/middleware appearance */
    .custom-node.auth-node {
      border-radius: 14px;
      box-shadow: 0 4px 14px rgba(180, 83, 9, 0.25);
      min-width: 200px;
    }
    /* Plugin node - container appearance */
    .custom-node.plugin-node {
      border-radius: 12px;
      box-shadow: 0 4px 12px rgba(217, 119, 6, 0.2);
      border-style: dashed !important;
      min-width: 180px;
    }
    /* Server/Scope nodes - larger */
    .custom-node.server-node,
    .custom-node.scope-node {
      min-width: 200px;
    }

    /* Loading state */
    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      font-size: 16px;
      color: #6b7280;
    }

    /* Details panel - animated slide from right */
    .details-panel {
      position: fixed;
      top: 0;
      right: 0;
      width: 400px;
      height: 100vh;
      background: white;
      box-shadow: -4px 0 30px rgba(0,0,0,0.15);
      z-index: 1001;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      transform: translateX(100%);
      transition: transform 0.3s ease-out;
    }
    .details-panel.open {
      transform: translateX(0);
    }
    .details-header {
      padding: 16px 20px;
      border-bottom: 1px solid #e5e7eb;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .details-header h2 {
      font-size: 16px;
      color: #1f2937;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .details-close {
      background: none;
      border: none;
      font-size: 20px;
      cursor: pointer;
      color: #6b7280;
      padding: 4px 8px;
      border-radius: 4px;
    }
    .details-close:hover {
      background: #f3f4f6;
    }
    .details-content {
      padding: 16px 20px;
      overflow-y: auto;
      flex: 1;
    }
    .details-section {
      margin-bottom: 16px;
    }
    .details-section:last-child {
      margin-bottom: 0;
    }
    .details-section h3 {
      font-size: 11px;
      text-transform: uppercase;
      color: #6b7280;
      margin-bottom: 8px;
      letter-spacing: 0.5px;
    }
    .details-value {
      font-size: 13px;
      color: #1f2937;
      background: #f9fafb;
      padding: 10px 12px;
      border-radius: 6px;
      font-family: 'SF Mono', Monaco, monospace;
      word-break: break-all;
    }
    .details-value.json {
      white-space: pre-wrap;
      max-height: 200px;
      overflow-y: auto;
    }
    .details-badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 500;
    }
    .details-path {
      font-size: 12px;
      color: #6b7280;
      margin-top: 4px;
    }
  </style>
</head>
<body>
  <div id="root">
    <div class="loading">Loading graph visualization...</div>
  </div>

  <script type="module">
    import React, { useMemo, useCallback, useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import {
      ReactFlow,
      Background,
      Controls,
      MiniMap,
      useNodesState,
      useEdgesState,
      Handle,
      Position
    } from '@xyflow/react';
    import dagre from 'dagre';

    // Graph data injected from server
    const graphData = ${JSON.stringify(graphData)};

    // Node type configurations
    const nodeConfig = {
      server: { fill: '#f5f3ff', stroke: '#7c3aed', icon: '🖥️', textColor: '#5b21b6' },
      scope: { fill: '#eff6ff', stroke: '#2563eb', icon: '📦', textColor: '#1d4ed8' },
      app: { fill: '#ecfdf5', stroke: '#059669', icon: '📱', textColor: '#047857' },
      plugin: { fill: '#fffbeb', stroke: '#d97706', icon: '🔌', textColor: '#b45309' },
      adapter: { fill: '#fef2f2', stroke: '#dc2626', icon: '🔗', textColor: '#b91c1c' },
      tool: { fill: '#ecfeff', stroke: '#0891b2', icon: '🔧', textColor: '#0e7490' },
      resource: { fill: '#eef2ff', stroke: '#4f46e5', icon: '📄', textColor: '#4338ca' },
      'resource-template': { fill: '#faf5ff', stroke: '#7c3aed', icon: '📋', textColor: '#6d28d9' },
      prompt: { fill: '#fdf2f8', stroke: '#be185d', icon: '💬', textColor: '#9d174d' },
      auth: { fill: '#fef3c7', stroke: '#b45309', icon: '🛡️', textColor: '#92400e' },
    };

    // Custom node component with type-specific styling
    function CustomNode({ data, type }) {
      const config = nodeConfig[type] || nodeConfig.tool;

      // Build class name based on node type
      let className = 'custom-node';
      if (type === 'auth') className += ' auth-node';
      if (type === 'plugin') className += ' plugin-node';
      if (type === 'server') className += ' server-node';
      if (type === 'scope') className += ' scope-node';

      // Border style
      const borderWidth = (type === 'auth' || type === 'plugin') ? '3px' : '2px';
      const borderStyle = type === 'plugin' ? 'dashed' : 'solid';

      return React.createElement('div', {
        className: className,
        style: {
          background: config.fill,
          border: borderWidth + ' ' + borderStyle + ' ' + config.stroke,
        }
      },
        // Horizontal layout: target on left, source on right
        React.createElement(Handle, { type: 'target', position: Position.Left, style: { visibility: 'hidden' } }),
        React.createElement('div', {
          className: 'node-type',
          style: { color: config.textColor }
        }, config.icon + ' ' + (data.authType || type)),
        React.createElement('div', { className: 'node-label' }, data.label),
        // Show description for tools if available
        data.description ? React.createElement('div', { className: 'node-desc' }, data.description) : null,
        React.createElement(Handle, { type: 'source', position: Position.Right, style: { visibility: 'hidden' } })
      );
    }

    // Create node types object
    const nodeTypes = {};
    Object.keys(nodeConfig).forEach(type => {
      nodeTypes[type] = (props) => CustomNode({ ...props, type });
    });

    // Node size configuration for Dagre layout
    const nodeSizes = {
      server: { width: 220, height: 70 },
      scope: { width: 220, height: 70 },
      auth: { width: 220, height: 70 },
      app: { width: 200, height: 70 },
      plugin: { width: 200, height: 70 },
      tool: { width: 200, height: 80 },
      resource: { width: 200, height: 70 },
      prompt: { width: 200, height: 70 },
    };

    // Layout with Dagre - horizontal layout (LR = left to right)
    function layoutGraph(graphData) {
      const g = new dagre.graphlib.Graph();
      g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 150, marginx: 50, marginy: 50 });
      g.setDefaultEdgeLabel(() => ({}));

      // Add nodes with type-specific sizes
      graphData.nodes.forEach(node => {
        const size = nodeSizes[node.type] || { width: 200, height: 70 };
        g.setNode(node.id, { width: size.width, height: size.height });
      });

      // Add edges
      graphData.edges.forEach(edge => {
        g.setEdge(edge.source, edge.target);
      });

      dagre.layout(g);

      // Map to React Flow format
      const nodes = graphData.nodes.map(node => {
        const pos = g.node(node.id);
        const size = nodeSizes[node.type] || { width: 200, height: 70 };
        return {
          id: node.id,
          type: node.type,
          position: { x: pos.x - size.width / 2, y: pos.y - size.height / 2 },
          data: { label: node.label, ...node.data },
        };
      });

      const edges = graphData.edges.map(edge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'smoothstep',
        animated: edge.type === 'provides',
        style: edge.type === 'provides'
          ? { stroke: '#0891b2', strokeWidth: 2, strokeDasharray: '5,5' }
          : { stroke: '#94a3b8', strokeWidth: 2 },
        markerEnd: { type: 'arrowclosed', color: edge.type === 'provides' ? '#0891b2' : '#94a3b8' },
      }));

      return { nodes, edges };
    }

    // Details Panel component - shows node information when clicked
    function DetailsPanel({ node, onClose }) {
      if (!node) return null;

      const config = nodeConfig[node.type] || nodeConfig.tool;
      const data = node.data || {};

      // Helper to render a section
      const renderSection = (title, content) => {
        if (!content) return null;
        return React.createElement('div', { className: 'details-section' },
          React.createElement('h3', null, title),
          React.createElement('div', { className: 'details-value' }, content)
        );
      };

      // Helper to render JSON section
      const renderJsonSection = (title, obj) => {
        if (!obj || Object.keys(obj).length === 0) return null;
        return React.createElement('div', { className: 'details-section' },
          React.createElement('h3', null, title),
          React.createElement('div', { className: 'details-value json' },
            JSON.stringify(obj, null, 2)
          )
        );
      };

      // Build content based on node type
      const sections = [];

      // Node ID
      sections.push(renderSection('Node ID', node.id));

      // Type-specific sections
      if (node.type === 'auth') {
        sections.push(renderSection('Auth Mode', data.authMode || 'unknown'));
        sections.push(renderSection('Auth Type', data.authType || 'unknown'));
        sections.push(renderSection('Protects', data.protects || 'scope'));
      }

      if (node.type === 'tool') {
        if (data.description) sections.push(renderSection('Description', data.description));
        if (data.tags && data.tags.length > 0) {
          sections.push(renderSection('Tags', data.tags.join(', ')));
        }
      }

      if (node.type === 'resource' || node.type === 'resource-template') {
        if (data.uri) sections.push(renderSection('URI', data.uri));
        if (data.mimeType) sections.push(renderSection('MIME Type', data.mimeType));
        if (data.description) sections.push(renderSection('Description', data.description));
      }

      if (node.type === 'prompt') {
        if (data.description) sections.push(renderSection('Description', data.description));
        sections.push(renderJsonSection('Arguments', data.arguments));
      }

      if (node.type === 'server') {
        sections.push(renderSection('Entry File', graphData.metadata.entryFile));
        if (data.description) sections.push(renderSection('Description', data.description));
      }

      // All data as JSON (excluding label to avoid redundancy)
      const dataForJson = { ...data };
      delete dataForJson.label;
      if (Object.keys(dataForJson).length > 0) {
        sections.push(renderJsonSection('Full Data', dataForJson));
      }

      return React.createElement('div', {
        className: 'details-panel open'
      },
        React.createElement('div', { className: 'details-header' },
          React.createElement('h2', null,
            React.createElement('span', {
              className: 'details-badge',
              style: { background: config.fill, color: config.textColor }
            }, config.icon + ' ' + node.type.toUpperCase()),
            data.label || node.id
          ),
          React.createElement('button', {
            className: 'details-close',
            onClick: onClose
          }, '×')
        ),
        React.createElement('div', { className: 'details-content' },
          ...sections.filter(Boolean)
        )
      );
    }

    // Main App component
    function GraphApp() {
      const { nodes: initialNodes, edges: initialEdges } = useMemo(
        () => layoutGraph(graphData),
        []
      );

      const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
      const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
      const [selectedNode, setSelectedNode] = useState(null);

      // Handle node click - show details panel
      const onNodeClick = useCallback((event, node) => {
        setSelectedNode(node);
      }, []);

      // Handle close panel
      const onClosePanel = useCallback(() => {
        setSelectedNode(null);
      }, []);

      // Handle pane click (clicking empty space) - close panel
      const onPaneClick = useCallback(() => {
        setSelectedNode(null);
      }, []);

      return React.createElement('div', { style: { width: '100%', height: '100%' } },
        // Header
        React.createElement('div', { className: 'header' },
          React.createElement('h1', null, graphData.metadata.serverName),
          React.createElement('div', { className: 'stats' },
            graphData.metadata.nodeCount + ' nodes · ' + graphData.metadata.edgeCount + ' edges'
          )
        ),

        // Legend
        React.createElement('div', { className: 'legend' },
          React.createElement('h3', null, 'Legend'),
          ...Object.entries(nodeConfig).map(([type, config]) =>
            React.createElement('div', { key: type, className: 'legend-item' },
              React.createElement('div', {
                className: 'legend-color',
                style: { background: config.fill, borderColor: config.stroke }
              }),
              React.createElement('span', null,
                config.icon + ' ' + type.charAt(0).toUpperCase() + type.slice(1)
              )
            )
          )
        ),

        // React Flow canvas
        React.createElement(ReactFlow, {
          nodes: nodes,
          edges: edges,
          onNodesChange: onNodesChange,
          onEdgesChange: onEdgesChange,
          nodeTypes: nodeTypes,
          onNodeClick: onNodeClick,
          onPaneClick: onPaneClick,
          nodesDraggable: false,
          fitView: true,
          fitViewOptions: { padding: 0.2 },
          minZoom: 0.1,
          maxZoom: 2,
        },
          React.createElement(Background, { color: '#e2e8f0', gap: 16 }),
          React.createElement(Controls, null),
          React.createElement(MiniMap, {
            nodeColor: (node) => {
              const config = nodeConfig[node.type];
              return config ? config.stroke : '#94a3b8';
            },
            maskColor: 'rgba(248, 250, 252, 0.8)'
          })
        ),

        // Details panel (rendered when a node is selected)
        selectedNode ? React.createElement(DetailsPanel, {
          node: selectedNode,
          onClose: onClosePanel
        }) : null
      );
    }

    // Mount React app
    const root = createRoot(document.getElementById('root'));
    root.render(React.createElement(GraphApp));
  </script>
</body>
</html>`;
}
