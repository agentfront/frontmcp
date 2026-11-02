/**
 * `@FrontMcp`, `@App`, `@Plugin` and `@Agent` take the value and class providers `ProviderType`
 * describes (`{ provide, useValue }`, `{ provide, useClass }`), as `dynamicProviders()` and the
 * provider registry already do. `name` is optional.
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

  it('take value and class providers without a name', () => {
    expect(() => {
      @App({ name: 'unnamed-value', providers: [{ provide: API_URL, useValue: 'https://api.example.com' }] })
      class UnnamedValueApp {}
      return UnnamedValueApp;
    }).not.toThrow();
    expect(() => {
      @Plugin({ name: 'unnamed-class', providers: [{ provide: GREETER, useClass: Greeter }] })
      class UnnamedClassPlugin {}
      return UnnamedClassPlugin;
    }).not.toThrow();
  });

  it('refuse an empty name', () => {
    expect(() => {
      @App({ name: 'empty-name', providers: [{ name: '', provide: API_URL, useValue: 'https://api.example.com' }] })
      class EmptyNameApp {}
      return EmptyNameApp;
    }).toThrow(InvalidDecoratorMetadataError);
  });

  it.each([
    ['useClass', { name: 'greeter', provide: GREETER, useClass: 'Greeter' }],
    ['useFactory', { name: 'greeter', provide: GREETER, useFactory: 'createGreeter' }],
  ])('refuse a %s that is not a function', (_field, provider) => {
    expect(() => {
      @App({
        name: 'malformed-provider',
        // @ts-expect-error -- a provider whose useClass or useFactory is not a function is refused at runtime
        providers: [provider],
      })
      class MalformedProviderApp {}
      return MalformedProviderApp;
    }).toThrow(InvalidDecoratorMetadataError);
  });
});
