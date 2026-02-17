import { useStoreResource, useCallTool } from '@frontmcp/react';

export function StorePage() {
  return (
    <div className="page">
      <div className="page-header">
        <h2>Store Plugin</h2>
      </div>
      <p>Reactive state stores exposed as MCP resources with live subscriptions.</p>

      <CounterSection />
      <TodoSection />
    </div>
  );
}

function CounterSection() {
  const { data, loading, error, refetch } = useStoreResource('state://counter');
  const [callSetState, setStateResult] = useCallTool('set_state');

  const count = (data as Record<string, unknown>)?.count ?? 0;

  const increment = async () => {
    await callSetState({ store: 'counter', path: ['count'], value: (count as number) + 1 });
    refetch();
  };

  const decrement = async () => {
    await callSetState({ store: 'counter', path: ['count'], value: (count as number) - 1 });
    refetch();
  };

  const reset = async () => {
    await callSetState({ store: 'counter', path: ['count'], value: 0 });
    refetch();
  };

  return (
    <div className="section">
      <h3>Counter Store</h3>
      <div className="hook-demo">
        <div className="hook-input">
          <p>
            URI: <code>state://counter</code>
          </p>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button className="primary" onClick={decrement}>
              -
            </button>
            <span style={{ fontSize: '2em', fontWeight: 'bold', minWidth: '60px', textAlign: 'center' }}>
              {loading ? '...' : String(count)}
            </span>
            <button className="primary" onClick={increment}>
              +
            </button>
            <button onClick={reset}>Reset</button>
          </div>
          {error && <p style={{ color: 'red' }}>Error: {error.message}</p>}
          {setStateResult.error && <p style={{ color: 'red' }}>Set error: {setStateResult.error.message}</p>}
        </div>
        <div className="hook-state">
          <h4>Full State</h4>
          <pre>{JSON.stringify(data, null, 2)}</pre>
        </div>
      </div>
    </div>
  );
}

function TodoSection() {
  const { data, loading, error, refetch } = useStoreResource('state://todos');
  const [callSetState] = useCallTool('set_state');

  const todos = data as { items?: Array<{ id: number; text: string; done: boolean }>; filter?: string } | null;

  const toggleTodo = async (index: number) => {
    if (!todos?.items) return;
    const item = todos.items[index];
    await callSetState({
      store: 'todos',
      path: ['items', `[${index}]`, 'done'],
      value: !item.done,
    });
    refetch();
  };

  return (
    <div className="section">
      <h3>Todo Store</h3>
      <div className="hook-demo">
        <div className="hook-input">
          <p>
            URI: <code>state://todos</code>
          </p>
          {loading && <p>Loading...</p>}
          {error && <p style={{ color: 'red' }}>Error: {error.message}</p>}
          {todos?.items && (
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {todos.items.map((item, i) => (
                <li
                  key={item.id}
                  style={{
                    padding: '8px',
                    cursor: 'pointer',
                    textDecoration: item.done ? 'line-through' : 'none',
                    opacity: item.done ? 0.6 : 1,
                  }}
                  onClick={() => toggleTodo(i)}
                >
                  {item.done ? '[x]' : '[ ]'} {item.text}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="hook-state">
          <h4>Full State</h4>
          <pre>{JSON.stringify(data, null, 2)}</pre>
        </div>
      </div>
    </div>
  );
}
