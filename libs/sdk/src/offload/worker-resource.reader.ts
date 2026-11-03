import { tokenName, type Token } from '@frontmcp/di';

import type { ProviderEntry, ScopeEntry } from '../common/entries';
import { FlowControl } from '../common/interfaces/flow.interface';
import type {
  ProviderRegistryInterface,
  ProviderViews,
  RegistryKind,
  RegistryType,
} from '../common/interfaces/internal/registry.interface';
import type { FrontMcpLogger } from '../common/interfaces/logger.interface';
import { ResourceContext, type ResourceCtorArgs } from '../common/interfaces/resource.interface';
import { ProviderNotAvailableError } from '../errors/provider.errors';
import type { WorkerLog, WorkerLogLevel } from './offload-worker.globals';
import type { AnyResourceMetadata, WorkerResourceHandler, WorkerResourceTarget } from './worker-resources';

/** Build a `worker: true` resource inside its worker, with no DI container, and run its read. */
export async function readWorkerResource(
  target: WorkerResourceTarget,
  metadata: AnyResourceMetadata,
  uri: string,
  params: Record<string, string>,
  log: WorkerLog,
): Promise<unknown> {
  const args: ResourceCtorArgs = {
    metadata,
    uri,
    params,
    providers: new WorkerProviders(`resource "${metadata.name}" reads in a worker thread (worker: true)`),
    logger: workerLogger(log),
    authInfo: {},
  };
  const context =
    target.kind === 'class' ? new target.cls(args) : new WorkerFunctionResourceContext(target.handler, args);
  try {
    return await context.execute(uri, params);
  } catch (error) {
    if (!(error instanceof FlowControl)) throw error;
    if (error.type === 'respond') return error.output;
    const original: unknown = Reflect.get(error, 'originalError');
    throw original ?? new Error(`The read ended with ${error.type}`);
  }
}

class WorkerFunctionResourceContext extends ResourceContext {
  constructor(
    private readonly handler: WorkerResourceHandler,
    args: ResourceCtorArgs,
  ) {
    super(args);
  }

  async execute(uri: string, params: Record<string, string>): Promise<unknown> {
    return this.handler(uri, params, this);
  }
}

/** A worker has no DI container: whatever is asked of it names the entry and why. */
export class WorkerProviders implements ProviderRegistryInterface {
  constructor(private readonly where: string) {}

  get<T>(token: Token<T>): T {
    throw this.unavailable(tokenName(token));
  }

  getScope(): ScopeEntry {
    throw this.unavailable('ScopeEntry');
  }

  getProviders(): ProviderEntry[] {
    throw this.unavailable('providers');
  }

  getRegistries<T extends RegistryKind>(type: T): RegistryType[T][] {
    throw this.unavailable(type);
  }

  buildViews(): Promise<ProviderViews> {
    throw this.unavailable('provider views');
  }

  private unavailable(what: string): ProviderNotAvailableError {
    return new ProviderNotAvailableError(what, `${this.where}, which has no DI container, scope or request context`);
  }
}

export function workerLogger(log: WorkerLog): FrontMcpLogger {
  const at =
    (level: WorkerLogLevel) =>
    (...args: unknown[]) =>
      log(level, args.map((arg) => (typeof arg === 'string' ? arg : describe(arg))).join(' '));
  const logger: FrontMcpLogger = {
    child: () => logger,
    verbose: at('verbose'),
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
  };
  return logger;
}

function describe(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
