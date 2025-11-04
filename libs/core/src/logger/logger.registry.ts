import 'reflect-metadata';
import {
  FrontMcpLogger,
  LogTransportType,
  LogTransportInterface,
  LoggingConfigType,
  ProviderScope,
  Token,
} from '@frontmcp/sdk';
import { RegistryAbstract, RegistryBuildMapResult } from '../regsitry';
import ProviderRegistry from '../provider/provider.registry';
import { LoggerKind, LoggerRecord } from './logger.types';
import { loggerDiscoveryDeps, normalizeLogger } from './logger.utils';
import { FrontMcpConfig } from '../front-mcp/front-mcp.tokens';
import { ConsoleLogTransportInstance } from './instances/instance.console-logger';
import { tokenName } from '../utils/token.utils';
import { GetTransports, LoggerInstance } from './instances/instance.logger';

export default class LoggerRegistry extends RegistryAbstract<LogTransportInterface, LoggerRecord, LogTransportType[]> {
  config: LoggingConfigType;

  constructor(globalProviders: ProviderRegistry) {
    const { logging } = globalProviders.get(FrontMcpConfig);
    const { transports, ...config } = logging;
    const list = transports ?? [];
    if (config.enableConsole) {
      list.push(ConsoleLogTransportInstance);
    }

    super('LoggerRegistry', globalProviders, list);

    this.config = config;
  }

  protected buildGraph() {
    for (const token of this.tokens) {
      const rec = this.defs.get(token)!;
      const deps = loggerDiscoveryDeps(rec).slice(1);
      for (const d of deps) {
        if (!this.providers.get(d)) {
          throw new Error(`Logger ${tokenName(token)} depends on ${tokenName(d)}, which is not registered.`);
        }
        this.graph.get(token)!.add(d);
      }
    }
  }

  protected override buildMap(list: LogTransportType[]): RegistryBuildMapResult<LoggerRecord> {
    const tokens = new Set<Token>();
    const defs = new Map<Token, LoggerRecord>();
    const graph = new Map<Token, Set<Token>>();


    for (const raw of list) {
      const rec = normalizeLogger(raw);
      const provide = rec.provide;
      tokens.add(provide);
      defs.set(provide, rec);
      graph.set(provide, new Set());
    }

    return {
      tokens,
      defs,
      graph,
    };
  }

  protected async initialize(): Promise<void> {

    for (const token of this.tokens) {
      const rec = this.defs.get(token)!;
      const deps = this.graph.get(token)!;

      const depsTokens = [...deps];
      const depsInstances = await Promise.all(depsTokens.map((t) => this.providers.resolveBootstrapDep(t)));

      let app: LogTransportInterface;
      if (rec.kind === LoggerKind.CLASS_TOKEN) {
        const LocalAppClass = rec.provide;
        app = new LocalAppClass(this.config, ...depsInstances);
      } else {
        throw Error('Invalid logger kind');
      }

      this.instances.set(token, app);
    }
    this.bindLogger();
  }

  protected bindLogger() {

    const consoleTransport = this.instances.get(ConsoleLogTransportInstance) as ConsoleLogTransportInstance;
    const transports = [...this.instances.values()];
    const getTransports: GetTransports = () => {
      return { consoleTransport, transports };
    };
    const logger = new LoggerInstance(this.config, getTransports);

    this.providers.injectProvider({
      provide: FrontMcpLogger,
      value: logger,
      metadata: {
        id: 'frontmcp-logger',
        name: 'FrontMcpLogger',
        scope: ProviderScope.GLOBAL,
        description: 'Logger instance that transport logs to all registered transporters.',
      },
    });
  }

}
