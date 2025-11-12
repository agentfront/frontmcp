import { Type } from '../interfaces';
import { z } from 'zod';
import {
  FrontMcpAdapterTokens, FrontMcpAuthProviderTokens,
  FrontMcpLocalAppTokens, FrontMcpLogTransportTokens,
  FrontMcpPluginTokens, FrontMcpPromptTokens,
  FrontMcpProviderTokens, FrontMcpResourceTokens,
  FrontMcpToolTokens,
} from '../tokens';
import {
  frontMcpAdapterMetadataSchema,
  frontMcpAuthProviderMetadataSchema, frontMcpPluginMetadataSchema,
  frontMcpProviderMetadataSchema,
} from '../metadata';

export const annotatedFrontMcpAppSchema = z.custom<Type>(
  (v): v is Type => typeof v === 'function' && Reflect.hasMetadata(FrontMcpLocalAppTokens.type, v),
  { message: 'apps items must be annotated with @App() | @FrontMcpApp().' },
);

export const annotatedFrontMcpProvidersSchema = z.custom<Type>(
  (v): v is Type => {
    return typeof v === 'function' && Reflect.hasMetadata(FrontMcpProviderTokens.type, v)
      ||
      (v['useValue'] && Reflect.hasMetadata(FrontMcpProviderTokens.type, v.useValue.constructor))
      ||
      (v['useFactory'] && frontMcpProviderMetadataSchema.passthrough().safeParse(v).success);
  },
  { message: 'plugins items must be annotated with @Provider() | @FrontMcpProvider().' },
);

export const annotatedFrontMcpAuthProvidersSchema = z.custom<Type>(
  (v): v is Type => {
    return typeof v === 'function' && Reflect.hasMetadata(FrontMcpAuthProviderTokens.type, v)
      ||
      (v['useValue'] && Reflect.hasMetadata(FrontMcpAuthProviderTokens.type, v.useValue.constructor))
      ||
      (v['useFactory'] && frontMcpAuthProviderMetadataSchema.passthrough().safeParse(v).success);
  },
  { message: 'plugins items must be annotated with @AuthProvider() | @FrontMcpAuthProvider().' },
);

export const annotatedFrontMcpPluginsSchema = z.custom<Type>(
  (v): v is Type => {
    return (typeof v === 'function' && Reflect.hasMetadata(FrontMcpPluginTokens.type, v))
      ||
      (v['useValue'] && Reflect.hasMetadata(FrontMcpPluginTokens.type, v.useValue.constructor))
      ||
      (v['useFactory'] && frontMcpPluginMetadataSchema.passthrough().safeParse(v).success);
  },
  { message: 'plugins items must be annotated with @Plugin() | @FrontMcpPlugin().' },
);

export const annotatedFrontMcpAdaptersSchema = z.custom<Type>(
  (v): v is Type => {
    return typeof v === 'function' && Reflect.hasMetadata(FrontMcpAdapterTokens.type, v)
      ||
      (v['useValue'] && Reflect.hasMetadata(FrontMcpAdapterTokens.type, v.useValue.constructor))
      ||
      (v['useFactory'] && frontMcpAdapterMetadataSchema.passthrough().safeParse(v).success);
  },
  { message: 'adapters items must be annotated with @Adapter() | @FrontMcpAdapter().' },
);

export const annotatedFrontMcpToolsSchema = z.custom<Type>(
  (v): v is Type => {
    return typeof v === 'function' && (
      Reflect.hasMetadata(FrontMcpToolTokens.type, v)
      ||
      v[FrontMcpToolTokens.type] !== undefined
    );
  },
  { message: 'tools items must be annotated with @Tool() | @FrontMcpTool().' },
);

export const annotatedFrontMcpResourcesSchema = z.custom<Type>(
  (v): v is Type => typeof v === 'function' && Reflect.hasMetadata(FrontMcpResourceTokens.type, v),
  { message: 'resources items must be annotated with @Resource() | @FrontMcpResource().' },
);

export const annotatedFrontMcpPromptsSchema = z.custom<Type>(
  (v): v is Type => typeof v === 'function' && Reflect.hasMetadata(FrontMcpPromptTokens.type, v),
  { message: 'prompts items must be annotated with @Prompt() | @FrontMcpPrompt().' },
);

export const annotatedFrontMcpLoggerSchema = z.custom<Type>(
  (v): v is Type => typeof v === 'function' && Reflect.hasMetadata(FrontMcpLogTransportTokens.type, v),
  { message: 'logger items must be annotated with @Logger() | @FrontMcpLogger().' },
);