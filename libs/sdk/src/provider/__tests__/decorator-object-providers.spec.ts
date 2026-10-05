/**
 * `@FrontMcp`, `@App`, `@Plugin` and `@Agent` take the value and class providers `ProviderType`
 * describes (`{ provide, name, useValue }`, `{ provide, name, useClass }`), as `dynamicProviders()`
 * and the provider registry already do, and still refuse one without a `name`.
 */
import 'reflect-metadata';

import {
  Agent,
  AgentContext,
  App,
  FrontMcp,
  LogLevel,
  Plugin,
  Tool,
  ToolContext,
  type ProviderType,
  type Reference,
} from '../../common';
import { type DirectMcpServer } from '../../direct/direct.types';
import { InvalidDecoratorMetadataError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

class Greeter {
  greet(name: string): string {
    return `hello ${name}`;
  }
}

const API_URL: Reference<string> = Symbol('api-url');
const GREETER: Reference<Greeter> = Symbol('greeter');

const greeterProvider: ProviderType = { name: 'greeter', provide: GREETER, useClass: Greeter };

@Plugin({ name: 'greetings', providers: [greeterProvider], exports: [greeterProvider] })
class GreetingsPlugin {}

@Tool({ name: 'describe_setup', inputSchema: {} })
class DescribeSetupTool extends ToolContext {
  async execute() {
    return { apiUrl: this.get(API_URL), greeting: this.get(GREETER).greet('ada') };
  }
}

@App({
  id: 'setup',
  name: 'Setup',
  providers: [{ name: 'api-url', provide: API_URL, useValue: 'https://api.example.com' }],
  plugins: [GreetingsPlugin],
  tools: [DescribeSetupTool],
})
class SetupApp {}

const llm = { adapter: { completion: async () => ({ content: 'done', finishReason: 'stop' as const }) } };

describe('value and class providers in decorator metadata', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'object-providers', version: '1.0.0' },
      apps: [SetupApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  it("resolve in tools from the app's providers and a plugin's exports", async () => {
    const result = await server.callTool('describe_setup', {});

    expect(result.structuredContent).toEqual({ apiUrl: 'https://api.example.com', greeting: 'hello ada' });
  });

  it('are accepted by @FrontMcp and @Agent', () => {
    expect(() => {
      @FrontMcp({ info: { name: 'unserved', version: '1.0.0' }, apps: [], providers: [greeterProvider], serve: false })
      class UnservedServer {}
      return UnservedServer;
    }).not.toThrow();
    expect(() => {
      @Agent({ name: 'greeter-agent', inputSchema: {}, llm, providers: [greeterProvider] })
      class GreeterAgent extends AgentContext {}
      return GreeterAgent;
    }).not.toThrow();
  });

  it('still require a name', () => {
    expect(() => {
      @App({
        name: 'unnamed-value',
        // @ts-expect-error -- a value provider without `name` is refused at runtime
        providers: [{ provide: API_URL, useValue: 'https://api.example.com' }],
      })
      class UnnamedValueApp {}
      return UnnamedValueApp;
    }).toThrow(InvalidDecoratorMetadataError);
    expect(() => {
      @Plugin({
        name: 'unnamed-class',
        // @ts-expect-error -- a class provider without `name` is refused at runtime
        providers: [{ provide: GREETER, useClass: Greeter }],
      })
      class UnnamedClassPlugin {}
      return UnnamedClassPlugin;
    }).toThrow(InvalidDecoratorMetadataError);
  });
});
