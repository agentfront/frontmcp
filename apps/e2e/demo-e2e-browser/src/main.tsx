import { Buffer } from 'buffer';
globalThis.Buffer = Buffer;

import 'reflect-metadata';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ServerRegistry } from '@frontmcp/react';
import OpenapiAdapter from '@frontmcp/adapters/openapi';
import StorePlugin from '@frontmcp/plugin-store';
import { App } from './App';
import { GreetTool, CalculateTool, RandomNumberTool } from './entries/tools';
import { ReadDomTool } from './entries/dom-tool';
import { AppInfoResource, NoteResource } from './entries/resources';
import { SummarizePrompt, CodeReviewPrompt } from './entries/prompts';
import { demoComponents } from './registry/demo-components';
import { counterStore, todoStore } from './stores/demo-store';
import { ServerManagerProvider } from './context/ServerManagerProvider';
import type { ManagedServer } from './context/ServerManagerContext';
import petStoreSpec from './specs/petstore.json';

async function bootstrap() {
  // OpenAPI adapter for PetStore
  const petStoreAdapter = OpenapiAdapter.init({
    name: 'petstore',
    baseUrl: 'https://petstore3.swagger.io/api/v3',
    spec: petStoreSpec,
    generateOptions: {
      includeSecurityInInput: true,
    },
  });

  // OpenAPI adapter from URL
  const beeceptorAdapter = OpenapiAdapter.init({
    name: 'beeceptor',
    url: 'https://frontmcp-test.proxy.beeceptor.com/openapi.json',
    baseUrl: 'https://frontmcp-test.proxy.beeceptor.com',
    staticAuth: { jwt: 'demo-bearer-token' },
  });

  const stores = { counter: counterStore, todos: todoStore };

  const server = await ServerRegistry.create('demo', {
    info: { name: 'browser-demo-react', version: '1.0.0' },
    tools: [GreetTool, CalculateTool, RandomNumberTool, ReadDomTool],
    resources: [AppInfoResource, NoteResource],
    prompts: [SummarizePrompt, CodeReviewPrompt],
    plugins: [StorePlugin.init({ stores })],
    adapters: [petStoreAdapter, beeceptorAdapter],
    machineId: 'browser-demo-react-' + Date.now(),
  });

  const demoManaged: ManagedServer = {
    id: 'demo',
    name: 'Demo Server',
    server,
    config: {
      toolIds: ['greet', 'calculate', 'random_number', 'read_dom'],
      resourceIds: ['app-info', 'note'],
      promptIds: ['summarize', 'code_review'],
      hasStorePlugin: true,
    },
    createdAt: Date.now(),
  };

  const root = createRoot(document.getElementById('root')!);
  root.render(
    <BrowserRouter>
      <ServerManagerProvider initialServers={[demoManaged]} defaultActiveId="demo">
        <App components={demoComponents} />
      </ServerManagerProvider>
    </BrowserRouter>,
  );
}

bootstrap();
