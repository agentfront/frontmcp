import React, { useEffect, useState } from 'react';

import { isWebMcpSupported, WebMcpPlugin } from '@frontmcp/plugin-webmcp';
import { create, FrontMcpProvider, useDynamicTool, z, type DirectMcpServer } from '@frontmcp/react';

import { CallRecorderPlugin } from './call-recorder.plugin';
import { AdminResetTool, PlaceOrderTool, SearchProductsTool } from './tools/shop.tools';

// Created once, outside React: StrictMode runs effects twice, and two servers would register the
// same WebMCP tool names.
const serverPromise = create({
  info: { name: 'e2e-webmcp', version: '1.0.0' },
  tools: [SearchProductsTool, AdminResetTool, PlaceOrderTool],
  plugins: [CallRecorderPlugin, WebMcpPlugin.init({ prefix: 'shop.' })],
});

/** While mounted, offers agents `cart_add`, a tool that changes this component's state. */
function CartPanel(): React.ReactElement {
  const [items, setItems] = useState<string[]>([]);

  useDynamicTool({
    name: 'cart_add',
    description: 'Add a product to the cart shown on the page',
    schema: z.object({ product: z.string() }),
    execute: async ({ product }) => {
      setItems((current) => [...current, product]);
      return { content: [{ type: 'text', text: `Added ${product}` }] };
    },
  });

  return (
    <section>
      <h2>Cart</h2>
      <ul data-testid="cart-items">
        {items.map((item, index) => (
          <li key={`${item}-${index}`}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

export function App(): React.ReactElement {
  const [server, setServer] = useState<DirectMcpServer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCart, setShowCart] = useState(true);
  const [disposed, setDisposed] = useState(false);

  useEffect(() => {
    serverPromise.then(setServer, (err: unknown) => setError(String(err)));
  }, []);

  if (error) return <div data-testid="init-error">Error: {error}</div>;
  if (!server) return <div data-testid="loading">Initializing MCP server...</div>;

  return (
    <FrontMcpProvider server={server} onError={(err) => console.error('Provider error:', err)}>
      <main style={{ padding: 16 }}>
        <h1>FrontMCP WebMCP E2E</h1>
        <p>
          WebMCP: <span data-testid="webmcp-supported">{isWebMcpSupported() ? 'supported' : 'unsupported'}</span>
        </p>
        <p>
          Server: <span data-testid="server-status">{disposed ? 'disposed' : 'ready'}</span>
        </p>
        <button data-testid="toggle-cart" onClick={() => setShowCart((shown) => !shown)}>
          {showCart ? 'Hide cart' : 'Show cart'}
        </button>
        <button
          data-testid="dispose-server"
          onClick={() => {
            void server.dispose().then(() => setDisposed(true));
          }}
        >
          Dispose server
        </button>
        {showCart && <CartPanel />}
      </main>
    </FrontMcpProvider>
  );
}
