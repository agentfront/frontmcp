import 'reflect-metadata';
import { ProviderScope, Token, tokenName } from '@frontmcp/di';
import { FrontMcpLogger, LogLevel, LogTransportType, LogTransportInterface, LoggingConfigType } from '../common';
import { RegistryAbstract, RegistryBuildMapResult } from '../regsitry';
import ProviderRegistry from '../provider/provider.registry';
import { LoggerKind, LoggerRecord } from './logger.types';
import { loggerDiscoveryDeps, normalizeLogger } from './logger.utils';
import { FrontMcpConfig } from '../front-mcp/front-mcp.tokens';
import { ConsoleLogTransportInstance } from './instances/instance.console-logger';
import { GetTransports, LoggerInstance } from './instances/instance.logger';
import { RegistryDependencyNotRegisteredError, InvalidRegistryKindError } from '../errors';

export default class LoggerRegistry extends RegistryAbstract<LogTransportInterface, LoggerRecord, LogTransportType[]> {
  config: LoggingConfigType;

  constructor(globalProviders: ProviderRegistry) {
    const { logging } = globalProviders.get(FrontMcpConfig);
    const loggingConfig = logging ?? {
      level: LogLevel.Info,
      enableConsole: true,
      transports: [] as LogTransportType[],
    };
    const { transports, ...config } = loggingConfig;
    const list: LogTransportType[] = [...(transports ?? [])];
    if (config.enableConsole) {
      list.push(ConsoleLogTransportInstance);
    }

    super('LoggerRegistry', globalProviders, list, false);

    this.config = config;
    this.buildGraph();
    this.ready = this.initialize();
  }

  protected buildGraph() {
    for (const token of this.tokens) {
      const rec = this.defs.get(token)!;
      const deps = loggerDiscoveryDeps(rec).slice(1);
      for (const d of deps) {
        if (!this.providers.get(d)) {
          throw new RegistryDependencyNotRegisteredError('Logger', tokenName(token), tokenName(d));
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
        throw new InvalidRegistryKindError('logger', (rec as { kind?: string }).kind);
      }

      this.instances.set(token, app);
    }
    this.bindLogger();
  }

  /** The mutable transports array — shared by all loggers via getTransports closure. */
  private _transports: LogTransportInterface[] = [];

  protected bindLogger() {
    const consoleTransport = this.instances.get(ConsoleLogTransportInstance) as ConsoleLogTransportInstance;
    this._transports = [...this.instances.values()];
    const transports = this._transports;
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

    // Inject self so scope/plugins can add transports post-initialization
    this.providers.injectProvider({
      provide: LoggerRegistry,
      value: this,
      metadata: {
        id: 'frontmcp-logger-registry',
        name: 'LoggerRegistry',
        scope: ProviderScope.GLOBAL,
        description: 'Logger registry for post-init transport injection.',
      },
    });
  }

  /**
   * Add a transport to the logger pipeline after initialization.
   *
   * The transport will receive all future log records. Existing child loggers
   * created via logger.child() will also receive logs through this transport
   * because they share the same getTransports closure.
   *
   * Used by the observability system to inject StructuredLogTransport
   * after plugin initialization.
   */
  addTransport(transport: LogTransportInterface): void {
    this._transports.push(transport);
  }

  /**
   * Remove the built-in ConsoleLogTransportInstance.
   *
   * Called when observability structured logging replaces it with a
   * ConsoleSink that provides human-readable output with trace context.
   * Prevents double console output.
   */
  removeConsoleTransport(): void {
    const idx = this._transports.findIndex((t) => t instanceof ConsoleLogTransportInstance);
    if (idx !== -1) {
      this._transports.splice(idx, 1);
    }
  }
}
