/// <reference types="jest" />
/**
 * Test fixtures for providers
 */

import 'reflect-metadata';
import { ProviderMetadata, ProviderScope } from '../../common/metadata';
import { ProviderInterface } from '../../common/interfaces';
import { FrontMcpProviderTokens } from '../../common/tokens/provider.tokens';

/**
 * Simple decorator to enable metadata emission
 */
function Injectable() {
  return function (target: any) {
    // Empty decorator to enable metadata emission
  };
}

/**
 * Simple test service class
 */
@Injectable()
export class TestService implements ProviderInterface {
  public readonly name = 'TestService';

  constructor() {}

  greet(): string {
    return `Hello from ${this.name}`;
  }
}

/**
 * Service that depends on another service
 */
@Injectable()
export class DependentService implements ProviderInterface {
  constructor(public readonly testService: TestService) {}

  callGreet(): string {
    return this.testService.greet();
  }
}

/**
 * Service with async initialization
 */
@Injectable()
export class AsyncService implements ProviderInterface {
  private initialized = false;

  async with(callback: (service: this) => Promise<void>): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
    await callback(this);
  }

  async init(): Promise<void> {
    // Simulate async initialization
    await new Promise((resolve) => setTimeout(resolve, 10));
    this.initialized = true;
  }

  isReady(): boolean {
    return this.initialized;
  }
}

/**
 * Token for testing symbol-based injection
 */
export const TEST_TOKEN = Symbol('TEST_TOKEN');
export const ASYNC_TOKEN = Symbol('ASYNC_TOKEN');
export const FACTORY_TOKEN = Symbol('FACTORY_TOKEN');

/**
 * Creates a provider metadata object with defaults
 */
export function createProviderMetadata(overrides: Partial<ProviderMetadata> = {}): ProviderMetadata {
  return {
    name: 'TestProvider',
    scope: ProviderScope.GLOBAL,
    ...overrides,
  };
}

/**
 * Creates a simple value provider
 */
export function createValueProvider<T>(provide: symbol, value: T, metadata?: Partial<ProviderMetadata>) {
  return {
    provide,
    useValue: value,
    ...createProviderMetadata(metadata),
  };
}

/**
 * Creates a simple factory provider
 */
export function createFactoryProvider<T>(provide: symbol, factory: () => T, metadata?: Partial<ProviderMetadata>) {
  return {
    provide,
    inject: () => [] as const,
    useFactory: factory,
    ...createProviderMetadata(metadata),
  };
}

/**
 * Creates a class provider with metadata using Reflect.defineMetadata
 * (same approach as the real FrontMcpProvider decorator)
 */
export function createClassProvider<T extends new (...args: any[]) => any>(
  cls: T,
  metadata?: Partial<ProviderMetadata>,
) {
  const metadataObj = createProviderMetadata(metadata);

  // Use Reflect.defineMetadata like the actual decorator does
  Reflect.defineMetadata(FrontMcpProviderTokens.type, true, cls);

  for (const property in metadataObj) {
    const token = FrontMcpProviderTokens[property as keyof ProviderMetadata] ?? property;
    Reflect.defineMetadata(token, metadataObj[property as keyof ProviderMetadata], cls);
  }

  return cls as T & ProviderMetadata;
}
