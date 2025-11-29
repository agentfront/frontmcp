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
  session?: SessionOptions;
  logging?: LoggingOptions;

  serve?: boolean; // default to true

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
  session: sessionOptionsSchema.optional(),
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
