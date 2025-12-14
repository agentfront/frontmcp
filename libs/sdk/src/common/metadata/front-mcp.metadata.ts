import { z } from 'zod';
import {
  AuthOptions,
  authOptionsSchema,
  SessionOptions,
  sessionOptionsSchema,
  ServerInfoOptions,
  serverInfoOptionsSchema,
  HttpOptions,
  httpOptionsSchema,
  LoggingOptions,
  loggingOptionsSchema,
  RawZodShape,
  AuthOptionsInput,
  RedisOptionsInput,
  redisOptionsSchema,
  TransportOptionsInput,
  transportOptionsSchema,
} from '../types';
import {
  annotatedFrontMcpAppSchema,
  annotatedFrontMcpProvidersSchema,
  annotatedFrontMcpResourcesSchema,
  annotatedFrontMcpToolsSchema,
} from '../schemas';
import { AppType, ProviderType, ResourceType, ToolType } from '../interfaces';

export interface FrontMcpBaseMetadata {
  info: ServerInfoOptions;
  apps: AppType[];
  http?: HttpOptions;
  logging?: LoggingOptions;

  serve?: boolean; // default to true

  /**
   * Shared Redis configuration
   * Used by transport persistence and auth token storage
   */
  redis?: RedisOptionsInput;

  /**
   * Transport and session lifecycle configuration
   * Controls transport protocols, session management, and persistence
   * @default {} (all transport options use their schema defaults)
   */
  transport?: TransportOptionsInput; // Optional in input, but always defined in output

  /**
   * @deprecated Use `transport` instead. Session config has been merged into transport.
   */
  session?: SessionOptions;

  /**
   * Additional providers that are available to all apps.
   */
  providers?: ProviderType[];

  /**
   * Shared tools that are available to all apps.
   * These are merged (additively) with app-specific tools.
   */
  tools?: ToolType[];

  /**
   * Shared resources that are available to all apps.
   * These are merged (additively) with app-specific resources.
   */
  resources?: ResourceType[];
}

export const frontMcpBaseSchema = z.object({
  info: serverInfoOptionsSchema,
  providers: z.array(annotatedFrontMcpProvidersSchema).optional().default([]),
  tools: z.array(annotatedFrontMcpToolsSchema).optional().default([]),
  resources: z.array(annotatedFrontMcpResourcesSchema).optional().default([]),
  apps: z.array(annotatedFrontMcpAppSchema),
  serve: z.boolean().optional().default(true),
  http: httpOptionsSchema.optional(),
  redis: redisOptionsSchema.optional(),
  transport: transportOptionsSchema.optional().transform((val) => val ?? transportOptionsSchema.parse({})),
  session: sessionOptionsSchema.optional(), // @deprecated - kept for backward compatibility
  logging: loggingOptionsSchema.optional(),
} satisfies RawZodShape<FrontMcpBaseMetadata>);

export interface FrontMcpMultiAppMetadata extends FrontMcpBaseMetadata {
  splitByApp?: false;
  auth?: AuthOptionsInput;
}

const frontMcpMultiAppSchema = frontMcpBaseSchema.extend({
  splitByApp: z.literal(false).default(false).describe('If true, each app gets its own scope & basePath.'),
  auth: authOptionsSchema.optional().describe("Configures the server's default authentication provider."),
} satisfies RawZodShape<FrontMcpMultiAppMetadata, FrontMcpBaseMetadata>);

export interface FrontMcpSplitByAppMetadata extends FrontMcpBaseMetadata {
  splitByApp: true;
  auth?: never;
}

const frontMcpSplitByAppSchema = frontMcpBaseSchema.extend({
  splitByApp: z.literal(true).describe('If false, apps are grouped under the same scope & basePath.'),
  auth: z.never().optional(),
} satisfies RawZodShape<FrontMcpSplitByAppMetadata, FrontMcpBaseMetadata>);

export type FrontMcpMetadata = FrontMcpMultiAppMetadata | FrontMcpSplitByAppMetadata;

export const frontMcpMetadataSchema = frontMcpMultiAppSchema.or(frontMcpSplitByAppSchema);

export type FrontMcpMultiAppConfig = z.infer<typeof frontMcpMultiAppSchema>;
export type FrontMcpSplitByAppConfig = z.infer<typeof frontMcpSplitByAppSchema>;

export type FrontMcpConfigType = z.infer<typeof frontMcpMetadataSchema>;

export interface AppScopeMetadata extends Omit<FrontMcpSplitByAppMetadata, 'auth' | 'splitByApp'> {
  id: string;
  apps: [AppType];
  auth?: AuthOptions;
}

export interface MultiAppScopeMetadata extends FrontMcpMultiAppMetadata {
  id: string;
  apps: AppType[];
}

export type ScopeMetadata = AppScopeMetadata | MultiAppScopeMetadata;
