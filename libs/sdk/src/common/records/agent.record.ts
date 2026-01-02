import { ProviderType, Type, Token } from '../interfaces';
import { AgentMetadata } from '../metadata';

/**
 * Discriminator enum for agent record types.
 */
export enum AgentKind {
  /** Agent defined as a class decorated with @Agent */
  CLASS_TOKEN = 'CLASS_TOKEN',
  /** Agent defined using agent() function decorator */
  FUNCTION = 'FUNCTION',
  /** Agent provided as a direct value (e.g., for testing) */
  VALUE = 'VALUE',
  /** Agent created via factory function */
  FACTORY = 'FACTORY',
}

/**
 * Record for class-based agents decorated with @Agent.
 *
 * @example
 * ```typescript
 * @Agent({
 *   name: 'research-agent',
 *   llm: { adapter: 'openai', model: 'gpt-4-turbo', apiKey: { env: 'OPENAI_API_KEY' } },
 * })
 * export default class ResearchAgent extends AgentContext { ... }
 * ```
 */
export interface AgentClassTokenRecord {
  kind: AgentKind.CLASS_TOKEN;
  provide: Type;
  metadata: AgentMetadata;
  providers?: ProviderType[];
}

/**
 * Record for function-based agents created with agent().
 *
 * @example
 * ```typescript
 * const researchAgent = agent({
 *   name: 'research-agent',
 *   inputSchema: { topic: z.string() },
 *   llm: { adapter: 'openai', model: 'gpt-4-turbo', apiKey: { env: 'OPENAI_API_KEY' } },
 * })((input, ctx) => {
 *   return { result: 'done' };
 * });
 * ```
 */
export interface AgentFunctionTokenRecord {
  kind: AgentKind.FUNCTION;
  // NOTE: `any` is intentional - function providers must be loosely typed
  // to support various input/output schema combinations at runtime
  provide: (...args: any[]) => any | Promise<any>;
  metadata: AgentMetadata;
  providers?: ProviderType[];
}

/**
 * Record for agents provided as direct values (useful for testing).
 */
export interface AgentValueRecord {
  kind: AgentKind.VALUE;
  provide: Token;
  useValue: unknown;
  metadata: AgentMetadata;
  providers?: ProviderType[];
}

/**
 * Record for agents created via factory functions with DI injection.
 *
 * @example
 * ```typescript
 * {
 *   useFactory: (configService: ConfigService) => new CustomAgent(configService),
 *   inject: [ConfigService],
 *   metadata: { name: 'custom-agent', llm: { ... } },
 * }
 * ```
 */
export interface AgentFactoryRecord {
  kind: AgentKind.FACTORY;
  provide: Token;
  useFactory: (...args: unknown[]) => unknown | Promise<unknown>;
  inject?: Token[];
  metadata: AgentMetadata;
  providers?: ProviderType[];
}

/**
 * Union type of all possible agent record types.
 */
export type AgentRecord = AgentClassTokenRecord | AgentFunctionTokenRecord | AgentValueRecord | AgentFactoryRecord;
