/**
 * FrontMCP Browser - React Example
 *
 * This example demonstrates:
 * - Using FrontMcpProvider with a custom server
 * - React hooks: useStore, useTool, useResource, useMcp
 * - Page context for AI discovery
 * - Component registration
 * - Human-in-the-loop with useElicit
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserMcpServer, createMcpStore } from '@frontmcp/browser';
import { FrontMcpProvider } from '@frontmcp/browser/react';
import { App } from './App';
import type { AppState } from './types';

// =============================================================================
// Store Setup
// =============================================================================

const store = createMcpStore<AppState>({
  initialState: {
    count: 0,
    user: null,
    todos: [],
    theme: 'light',
    lastAction: 'initialized',
  },
});

// =============================================================================
// Server Setup
// =============================================================================

const server = new BrowserMcpServer({
  name: 'react-example',
  store,
});

// Add counter tools
server.addTool({
  name: 'increment',
  description: 'Increment the counter',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    store.state.count++;
    store.state.lastAction = 'increment';
    return { count: store.state.count };
  },
});

server.addTool({
  name: 'decrement',
  description: 'Decrement the counter',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    store.state.count--;
    store.state.lastAction = 'decrement';
    return { count: store.state.count };
  },
});

// Add todo tools
server.addTool({
  name: 'add-todo',
  description: 'Add a new todo item',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Todo text' },
    },
    required: ['text'],
  },
  handler: async (args) => {
    const text = args['text'] as string;
    const todo = {
      id: Date.now().toString(),
      text,
      completed: false,
    };
    store.state.todos.push(todo);
    store.state.lastAction = `Added todo: ${text}`;
    return { todo };
  },
});

server.addTool({
  name: 'toggle-todo',
  description: 'Toggle a todo item completion status',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Todo ID' },
    },
    required: ['id'],
  },
  handler: async (args) => {
    const id = args['id'] as string;
    const todo = store.state.todos.find((t) => t.id === id);
    if (todo) {
      todo.completed = !todo.completed;
      store.state.lastAction = `Toggled todo: ${todo.text}`;
      return { todo };
    }
    return { error: 'Todo not found' };
  },
});

server.addTool({
  name: 'set-theme',
  description: 'Set the application theme',
  inputSchema: {
    type: 'object',
    properties: {
      theme: { type: 'string', enum: ['light', 'dark'], description: 'Theme name' },
    },
    required: ['theme'],
  },
  handler: async (args) => {
    const theme = args['theme'] as 'light' | 'dark';
    store.state.theme = theme;
    store.state.lastAction = `Set theme: ${theme}`;
    return { theme };
  },
});

// Add resources
server.addResource({
  uri: 'store://state',
  name: 'Application State',
  description: 'Current application state',
  handler: async () => ({
    contents: [
      {
        uri: 'store://state',
        mimeType: 'application/json',
        text: JSON.stringify(store.getSnapshot(), null, 2),
      },
    ],
  }),
});

server.addResource({
  uri: 'store://todos',
  name: 'Todo List',
  description: 'Current todo items',
  handler: async () => ({
    contents: [
      {
        uri: 'store://todos',
        mimeType: 'application/json',
        text: JSON.stringify(store.state.todos, null, 2),
      },
    ],
  }),
});

// =============================================================================
// App Render
// =============================================================================

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <FrontMcpProvider server={server}>
      <App />
    </FrontMcpProvider>
  </React.StrictMode>,
);
