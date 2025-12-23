/**
 * Main App component demonstrating FrontMCP React integration
 */

import * as React from 'react';
import {
  useStore,
  useTool,
  useResource,
  useMcp,
  usePageContext,
  useElicit,
  ElicitDialog,
} from '@frontmcp/browser/react';
import type { AppState, Todo } from './types';

// =============================================================================
// Counter Component
// =============================================================================

function Counter() {
  const { state } = useStore<AppState>();
  const increment = useTool('increment');
  const decrement = useTool('decrement');

  // Register this component for AI discovery
  usePageContext().registerElement({
    type: 'counter',
    name: 'Counter',
    value: state.count,
    actions: ['increment', 'decrement'],
  });

  return (
    <div className="card">
      <h2>Counter</h2>
      <p className="count">{state.count}</p>
      <div className="button-group">
        <button onClick={() => decrement.execute({})} disabled={decrement.isLoading}>
          -
        </button>
        <button onClick={() => increment.execute({})} disabled={increment.isLoading}>
          +
        </button>
      </div>
      {(increment.error || decrement.error) && (
        <p className="error">Error: {increment.error?.message || decrement.error?.message}</p>
      )}
    </div>
  );
}

// =============================================================================
// Todo List Component
// =============================================================================

function TodoList() {
  const { state, store } = useStore<AppState>();
  const addTodo = useTool<{ text: string }, { todo: Todo }>('add-todo');
  const toggleTodo = useTool<{ id: string }, { todo: Todo }>('toggle-todo');
  const [newTodoText, setNewTodoText] = React.useState('');
  const pageContext = usePageContext();

  // Register todo list for AI discovery
  React.useEffect(() => {
    const id = pageContext.registerElement({
      type: 'list',
      name: 'TodoList',
      itemCount: state.todos.length,
      actions: ['add-todo', 'toggle-todo', 'remove-todo'],
    });
    return () => pageContext.unregisterElement(id);
  }, [state.todos.length, pageContext]);

  const handleAddTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTodoText.trim()) return;
    await addTodo.execute({ text: newTodoText });
    setNewTodoText('');
  };

  return (
    <div className="card">
      <h2>Todo List</h2>
      <form onSubmit={handleAddTodo} className="todo-form">
        <input
          type="text"
          value={newTodoText}
          onChange={(e) => setNewTodoText(e.target.value)}
          placeholder="Add a todo..."
        />
        <button type="submit" disabled={addTodo.isLoading}>
          Add
        </button>
      </form>
      <ul className="todo-list">
        {state.todos.map((todo) => (
          <li
            key={todo.id}
            className={todo.completed ? 'completed' : ''}
            onClick={() => toggleTodo.execute({ id: todo.id })}
          >
            <span className="checkbox">{todo.completed ? '✓' : '○'}</span>
            <span className="text">{todo.text}</span>
          </li>
        ))}
      </ul>
      {state.todos.length === 0 && <p className="empty">No todos yet. Add one above!</p>}
    </div>
  );
}

// =============================================================================
// Theme Switcher Component
// =============================================================================

function ThemeSwitcher() {
  const { state } = useStore<AppState>();
  const setTheme = useTool<{ theme: string }, { theme: string }>('set-theme');

  return (
    <div className="theme-switcher">
      <button
        onClick={() => setTheme.execute({ theme: state.theme === 'light' ? 'dark' : 'light' })}
        disabled={setTheme.isLoading}
      >
        {state.theme === 'light' ? '🌙 Dark' : '☀️ Light'}
      </button>
    </div>
  );
}

// =============================================================================
// Resource Viewer Component
// =============================================================================

function ResourceViewer() {
  const stateResource = useResource<AppState>('store://state');
  const todosResource = useResource<Todo[]>('store://todos');
  const [activeTab, setActiveTab] = React.useState<'state' | 'todos'>('state');

  const activeResource = activeTab === 'state' ? stateResource : todosResource;

  return (
    <div className="card">
      <h2>MCP Resources</h2>
      <div className="tabs">
        <button className={activeTab === 'state' ? 'active' : ''} onClick={() => setActiveTab('state')}>
          store://state
        </button>
        <button className={activeTab === 'todos' ? 'active' : ''} onClick={() => setActiveTab('todos')}>
          store://todos
        </button>
      </div>
      <div className="resource-content">
        {activeResource.isLoading && <p>Loading...</p>}
        {activeResource.error && <p className="error">Error: {activeResource.error.message}</p>}
        {activeResource.data && <pre>{JSON.stringify(activeResource.data, null, 2)}</pre>}
      </div>
      <button onClick={() => activeResource.refetch()}>Refresh</button>
    </div>
  );
}

// =============================================================================
// MCP Status Component
// =============================================================================

function McpStatus() {
  const { server, listTools, listResources } = useMcp();
  const [tools, setTools] = React.useState<string[]>([]);
  const [resources, setResources] = React.useState<string[]>([]);

  React.useEffect(() => {
    const toolsList = server.getTools();
    const resourcesList = server.getResources();
    setTools(toolsList.map((t) => t.name));
    setResources(resourcesList.map((r) => r.name));
  }, [server]);

  return (
    <div className="card mcp-status">
      <h2>MCP Status</h2>
      <div className="status-grid">
        <div>
          <h3>Tools ({tools.length})</h3>
          <ul>
            {tools.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Resources ({resources.length})</h3>
          <ul>
            {resources.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Activity Log Component
// =============================================================================

function ActivityLog() {
  const { state } = useStore<AppState>();

  return (
    <div className="card activity-log">
      <h2>Last Action</h2>
      <p className="action">{state.lastAction}</p>
    </div>
  );
}

// =============================================================================
// Main App Component
// =============================================================================

export function App() {
  const { state } = useStore<AppState>();
  const { pendingRequest, respond, dismiss } = useElicit();

  // Apply theme
  React.useEffect(() => {
    document.body.className = `theme-${state.theme}`;
  }, [state.theme]);

  return (
    <div className="app">
      <header>
        <h1>FrontMCP Browser - React Example</h1>
        <ThemeSwitcher />
      </header>

      <main>
        <div className="grid">
          <Counter />
          <TodoList />
        </div>
        <div className="grid">
          <ResourceViewer />
          <McpStatus />
        </div>
        <ActivityLog />
      </main>

      {/* Human-in-the-loop dialog */}
      {pendingRequest && <ElicitDialog request={pendingRequest} onRespond={respond} onDismiss={dismiss} />}
    </div>
  );
}
