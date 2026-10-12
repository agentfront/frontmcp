/**
 * `FrontMcpConfigInput` types `apps`, `providers`, `plugins` and `adapters` as what the config schema accepts at
 * runtime. `nx typecheck sdk` checks the assignments below; Jest checks that the schema accepts or rejects each value.
 */
import 'reflect-metadata';

import {
  Adapter,
  App,
  DynamicAdapter,
  DynamicPlugin,
  frontMcpMetadataSchema,
  Plugin,
  Provider,
  type FrontMcpAdapterResponse,
  type FrontMcpConfigInput,
} from '../..';

type ConfigApp = FrontMcpConfigInput['apps'][number];
type ConfigProvider = NonNullable<FrontMcpConfigInput['providers']>[number];
type ConfigPlugin = NonNullable<FrontMcpConfigInput['plugins']>[number];
type ConfigAdapter = NonNullable<FrontMcpConfigInput['adapters']>[number];

@App({ name: 'local' })
class LocalApp {}

@Provider({ name: 'ledger' })
class LedgerStore {
  constructor(readonly owner: string) {}
}

interface AuditOptions {
  level: string;
}

@Plugin({ name: 'audit' })
class AuditPlugin extends DynamicPlugin<AuditOptions> {
  constructor(readonly options: AuditOptions) {
    super();
  }
}

interface StatusOptions {
  name: string;
}

@Adapter({ name: 'status' })
class StatusAdapter extends DynamicAdapter<StatusOptions> {
  constructor(readonly options: StatusOptions) {
    super();
  }

  async fetch(): Promise<FrontMcpAdapterResponse> {
    return {};
  }
}

const apps: ConfigApp[] = [
  LocalApp,
  App.remote('https://api.example.com/mcp', { namespace: 'api' }),
  App.esm('@acme/tools@^1.0.0', { namespace: 'acme' }),
];

const providers: ConfigProvider[] = [
  LedgerStore,
  { name: 'ledger-value', provide: LedgerStore, useValue: new LedgerStore('value') },
  { name: 'ledger-class', provide: LedgerStore, useClass: LedgerStore },
  { name: 'ledger-factory', provide: LedgerStore, useFactory: () => new LedgerStore('factory') },
];

const plugins: ConfigPlugin[] = [
  AuditPlugin,
  AuditPlugin.init({ level: 'info' }),
  AuditPlugin.init({ useFactory: () => ({ level: 'debug' }) }),
];

const adapters: ConfigAdapter[] = [
  StatusAdapter.init({ name: 'status-eu' }),
  StatusAdapter.init({ name: 'status-us', useFactory: () => ({ name: 'status-us' }) }),
];

const parse = (entries: Partial<FrontMcpConfigInput>) =>
  frontMcpMetadataSchema.safeParse({ info: { name: 'entries', version: '1.0.0' }, apps: [LocalApp], ...entries });

describe('FrontMcpConfigInput entries', () => {
  it('types every app the schema accepts: @App classes, App.remote() and App.esm()', () => {
    expect(parse({ apps }).success).toBe(true);
  });

  it('types every provider the schema accepts: @Provider classes and value, class and factory records', () => {
    expect(parse({ providers }).success).toBe(true);
  });

  it('types every plugin the schema accepts: @Plugin classes and init() value and factory records', () => {
    expect(parse({ plugins }).success).toBe(true);
  });

  it('types every adapter the schema accepts: init() value and factory records', () => {
    expect(parse({ adapters }).success).toBe(true);
  });

  it('rejects, in types and at runtime, record forms the schema does not accept', () => {
    // @ts-expect-error an app value record is not an app the schema accepts
    const valueApp: ConfigApp = { name: 'value-app', provide: LocalApp, useValue: new LocalApp() };
    // @ts-expect-error the schema accepts no useClass record for a plugin
    const classPlugin: ConfigPlugin = { name: 'audit', provide: AuditPlugin, useClass: AuditPlugin };
    // @ts-expect-error the schema accepts no useClass record for an adapter
    const classAdapter: ConfigAdapter = { name: 'status', provide: StatusAdapter, useClass: StatusAdapter };

    expect(parse({ apps: [valueApp] }).success).toBe(false);
    expect(parse({ plugins: [classPlugin] }).success).toBe(false);
    expect(parse({ adapters: [classAdapter] }).success).toBe(false);
  });
});
