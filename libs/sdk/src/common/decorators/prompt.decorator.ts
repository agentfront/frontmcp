import 'reflect-metadata';
import { FrontMcpPromptTokens, extendedPromptMetadata } from '../tokens';
import { PromptMetadata, frontMcpPromptMetadataSchema } from '../metadata';
import { GetPromptResult, GetPromptRequest } from '@frontmcp/protocol';
import { PromptContext } from '../interfaces';

/**
 * Decorator that marks a class as a McpPrompt module and provides metadata
 */
function FrontMcpPrompt(providedMetadata: PromptMetadata): ClassDecorator {
  return (target: Function) => {
    const metadata = frontMcpPromptMetadataSchema.parse(providedMetadata);

    Reflect.defineMetadata(FrontMcpPromptTokens.type, true, target);

    const extended: Record<string, unknown> = {};
    for (const property in metadata) {
      if (FrontMcpPromptTokens[property]) {
        Reflect.defineMetadata(FrontMcpPromptTokens[property], metadata[property], target);
      } else {
        extended[property] = metadata[property];
      }
    }
    Reflect.defineMetadata(extendedPromptMetadata, extended, target);
  };
}

export type FrontMcpPromptExecuteHandler = (
  args: GetPromptRequest['params']['arguments'],
  ...tokens: unknown[]
) => GetPromptResult | Promise<GetPromptResult>;

/**
 * Function-style prompt builder.
 * Returns a callable with attached metadata for registration.
 */
type FunctionalPromptResult = (() => FrontMcpPromptExecuteHandler) & {
  [key: symbol]: unknown;
};

function frontMcpPrompt<T extends PromptMetadata>(
  providedMetadata: T,
): (handler: FrontMcpPromptExecuteHandler) => FunctionalPromptResult {
  return (execute) => {
    const metadata = frontMcpPromptMetadataSchema.parse(providedMetadata);
    const toolFunction = function () {
      return execute;
    } as FunctionalPromptResult;
    Object.assign(toolFunction, {
      [FrontMcpPromptTokens.type]: 'function-prompt',
      [FrontMcpPromptTokens.metadata]: metadata,
    });
    return toolFunction;
  };
}

// ═══════════════════════════════════════════════════════════════════
// STATIC METHODS: Prompt.esm() and Prompt.remote()
// ═══════════════════════════════════════════════════════════════════

import type { EsmOptions, RemoteOptions } from '../metadata';
import { PromptKind } from '../records/prompt.record';
import type { PromptEsmTargetRecord, PromptRemoteRecord } from '../records/prompt.record';
import { parsePackageSpecifier } from '../../esm-loader/package-specifier';
import { validateRemoteUrl } from '../utils/validate-remote-url';

function promptEsm(specifier: string, targetName: string, options?: EsmOptions<PromptMetadata>): PromptEsmTargetRecord {
  const parsed = parsePackageSpecifier(specifier);
  return {
    kind: PromptKind.ESM,
    provide: Symbol(`esm-prompt:${parsed.fullName}:${targetName}`),
    specifier: parsed,
    targetName,
    options,
    metadata: {
      name: targetName,
      description: `Prompt "${targetName}" from ${parsed.fullName}`,
      arguments: [],
      ...options?.metadata,
    },
  };
}

function promptRemote(url: string, targetName: string, options?: RemoteOptions<PromptMetadata>): PromptRemoteRecord {
  validateRemoteUrl(url);
  return {
    kind: PromptKind.REMOTE,
    provide: Symbol(`remote-prompt:${url}:${targetName}`),
    url,
    targetName,
    transportOptions: options?.transportOptions,
    remoteAuth: options?.remoteAuth,
    metadata: {
      name: targetName,
      description: `Remote prompt "${targetName}" from ${url}`,
      arguments: [],
      ...options?.metadata,
    },
  };
}

Object.assign(FrontMcpPrompt, {
  esm: promptEsm,
  remote: promptRemote,
});

// ============================================================================
// Type Checking Helpers
// ============================================================================

// ---------- ctor & reflection ----------
// `any` is intentional in __Ctor and __R: using `unknown[]` breaks constructor
// inference and instance type extraction needed for decorator type checking.
type __Ctor = (new (...a: any[]) => any) | (abstract new (...a: any[]) => any);
type __R<C extends __Ctor> = C extends new (...a: any[]) => infer R
  ? R
  : C extends abstract new (...a: any[]) => infer R
    ? R
    : never;

// ---------- friendly branded errors ----------
type __MustExtendPromptCtx<C extends __Ctor> =
  __R<C> extends PromptContext ? unknown : { 'Prompt class error': 'Class must extend PromptContext' };

type PromptDecorator = {
  (metadata: PromptMetadata): <C extends __Ctor>(cls: C & __MustExtendPromptCtx<C>) => C;
  esm: typeof promptEsm;
  remote: typeof promptRemote;
};

const Prompt = FrontMcpPrompt as unknown as PromptDecorator;

export { FrontMcpPrompt, Prompt, frontMcpPrompt, frontMcpPrompt as prompt };
