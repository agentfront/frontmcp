import 'reflect-metadata';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { FrontMcpProvider, ServerRegistry } from '@frontmcp/react';
import { OpenapiAdapter } from '@frontmcp/adapters/openapi';
import StorePlugin from '@frontmcp/plugin-store';
import { App } from './App';
import { GreetTool, CalculateTool, RandomNumberTool } from './entries/tools';
import { ReadDomTool } from './entries/dom-tool';
import { AppInfoResource, NoteResource } from './entries/resources';
import { SummarizePrompt, CodeReviewPrompt } from './entries/prompts';
import { demoComponents } from './registry/demo-components';
import { counterStore, todoStore } from './stores/demo-store';
import petStoreSpec from './specs/petstore.json';

async function bootstrap() {
  // OpenAPI adapter for PetStore
  const petStoreAdapter = new OpenapiAdapter({
    name: 'petstore',
    baseUrl: 'https://petstore3.swagger.io/api/v3',
    spec: petStoreSpec,
    generateOptions: {
      includeSecurityInInput: true,
    },
  });

  // Store plugin resources
  const stores = { counter: counterStore, todos: todoStore };
  const storeResources = StorePlugin.createResources(stores);

  const server = await ServerRegistry.create('demo', {
    info: { name: 'browser-demo-react', version: '1.0.0' },
    tools: [GreetTool, CalculateTool, RandomNumberTool, ReadDomTool],
    resources: [AppInfoResource, NoteResource, ...storeResources],
    prompts: [SummarizePrompt, CodeReviewPrompt],
    plugins: [StorePlugin.init({ stores })],
    adapters: [petStoreAdapter],
    machineId: 'browser-demo-react-' + Date.now(),
  });

  const root = createRoot(document.getElementById('root')!);
  root.render(
    <BrowserRouter>
      <FrontMcpProvider server={server} components={demoComponents} autoConnect>
        <App />
      </FrontMcpProvider>
    </BrowserRouter>,
  );
}

bootstrap();
