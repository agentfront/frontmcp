import { Token, Type, tokenName } from '@frontmcp/di';
import ProviderRegistry from '../provider/provider.registry';
import { RegistryAbstract, RegistryBuildMapResult } from '../regsitry';
import { FlowInputOf, FlowName, FlowOutputOf, FlowRecord, FlowType, ScopeEntry } from '../common';
import { normalizeFlow } from './flow.utils';
import { FlowInstance } from './flow.instance';
import { FrontMcpContextStorage } from '../context';
import { randomUUID } from '@frontmcp/utils';

export default class FlowRegistry extends RegistryAbstract<FlowInstance<FlowName>, FlowRecord, FlowType[]> {
  constructor(providers: ProviderRegistry, list: FlowType[]) {
    super('FlowRegistry', providers, list);
  }

  protected override buildMap(list: FlowType[]): RegistryBuildMapResult<FlowRecord> {
    const tokens = new Set<Token>();
    const defs = new Map<Token, FlowRecord>();
    const graph = new Map<Token, Set<Token>>();

    for (const raw of list) {
      const rec = normalizeFlow(raw);
      const provide = rec.provide;
      tokens.add(provide);
      defs.set(provide, rec);
      graph.set(provide, new Set());
    }

    return { tokens, defs, graph };
  }

  protected buildGraph() {
    for (const token of this.tokens) {
      const rec = this.defs.get(token)!;
      const deps = rec.metadata.dependsOn ?? [];

      for (const d of deps) {
        if (d == ScopeEntry) {
          this.graph.get(token)!.add(ScopeEntry);
        } else {
          if (!this.providers.get(d)) {
            throw new Error(`Flow ${tokenName(token)} depends on ${tokenName(d)}, which is not registered.`);
          }
          this.graph.get(token)!.add(d);
        }
      }
    }
  }

  /** Instantiate adapters, run fetch/transform, and populate registries. */
  protected async initialize(): Promise<void> {
    const readyArr: Promise<void>[] = [];
    for (const token of this.tokens) {
      const instance = this.initializeOne(token);
      readyArr.push(instance.ready);
    }
    await Promise.all(readyArr);
  }

  private initializeOne(token: Token) {
    const rec = this.defs.get(token)!;
    const deps = this.graph.get(token)!;

    const instance = new FlowInstance(this.providers.getActiveScope(), rec, deps, this.providers);
    this.instances.set(rec.metadata.name, instance);
    return instance;
  }

  async registryFlows(rawFlows: FlowType[]): Promise<void> {
    const readyArr: Promise<void>[] = [];
    for (const raw of rawFlows) {
      const rec = normalizeFlow(raw);
      const provide = rec.provide;
      this.tokens.add(provide);
      this.defs.set(provide, rec);
      this.graph.set(provide, new Set());
      readyArr.push(this.initializeOne(provide).ready);
    }
    await Promise.all(readyArr);
  }

  runFlow<Name extends FlowName>(
    name: Name,
    input: FlowInputOf<Name>,
    deps?: Map<Token, Type>,
  ): Promise<FlowOutputOf<Name> | undefined> {
    const flow = this.instances.get(name);
    if (!flow) {
      throw new Error(`Flow ${name} is not registered`);
    }

    // Get context storage for MCP flows (if not already in a context)
    const contextStorage = this.getContextStorage();
    if (!contextStorage) {
      // No context storage available, run without context (backward compatibility)
      return flow.run(input, deps ?? new Map()) as Promise<FlowOutputOf<Name> | undefined>;
    }

    // Check if we're already in a context (e.g., HTTP middleware flow)
    const existingContext = contextStorage.getStore();
    if (existingContext) {
      // Already in context, run directly
      return flow.run(input, deps ?? new Map()) as Promise<FlowOutputOf<Name> | undefined>;
    }

    // Extract session info from MCP handler context (input.ctx.authInfo)
    // MCP handlers pass { request, ctx } where ctx has authInfo
    const mcpCtx = (input as any)?.ctx;
    const authInfo = mcpCtx?.authInfo;

    // Get session ID from authInfo (set by ensureAuthInfo in transport adapter)
    // Fall back to anonymous session if not available
    const rawSessionId = authInfo?.sessionId;
    const sessionId =
      typeof rawSessionId === 'string' && rawSessionId.trim().length > 0 ? rawSessionId.trim() : `anon:${randomUUID()}`;

    const scope = this.providers.getActiveScope();

    // Wrap flow execution in FrontMcpContext
    return Promise.resolve(
      contextStorage.run(
        {
          sessionId,
          scopeId: scope.id,
          authInfo,
        },
        async () => {
          return flow.run(input, deps ?? new Map()) as Promise<FlowOutputOf<Name> | undefined>;
        },
      ),
    );
  }

  /**
   * Get FrontMcpContextStorage from providers (with fallback).
   * Returns undefined if not available (backward compatibility).
   */
  private getContextStorage(): FrontMcpContextStorage | undefined {
    try {
      return this.providers.get(FrontMcpContextStorage);
    } catch {
      return undefined;
    }
  }
}
