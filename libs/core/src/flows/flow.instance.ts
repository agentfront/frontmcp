import 'reflect-metadata';
import {
  FlowControl,
  FlowEntry, FlowInputOf,
  FlowName, FlowOutputOf, FlowPlan,
  FlowRecord,
  FlowType,
  Reference,
  ServerRequest,
  Token, Type,
} from '@frontmcp/sdk';
import ProviderRegistry from '../provider/provider.registry';
import { collectHookMap, HookMap } from './flow.hooks';
import { writeHttpResponse } from '../server/server.validation';
import { Scope } from '../scope';


export class FlowInstance<Name extends FlowName> extends FlowEntry<Name> {
  readonly deps: Reference[];
  readonly globalProviders: ProviderRegistry;
  private plan: FlowPlan<never>;
  private FlowClass: FlowType;
  private hooks: HookMap<FlowType>;
  private globalDeps: Map<Token, Type>;

  constructor(scope: Scope, record: FlowRecord, deps: Set<Reference>, globalProviders: ProviderRegistry) {
    super(scope, record);
    this.deps = [...deps];
    this.globalProviders = globalProviders;
    this.FlowClass = this.record.provide;
    this.ready = this.initialize();
    this.plan = this.record.metadata.plan;
  }

  protected async initialize() {


    const server = this.globalProviders.getActiveServer();

    this.hooks = collectHookMap(this.FlowClass);
    this.globalDeps = new Map();// this.deps.map(dep => this.globalProviders.resolve(dep));

    const { middleware } = this.metadata;
    if (middleware) {
      const path = typeof middleware.path === 'string' ? middleware.path : '';
      server.registerMiddleware(path, async (request, response, next) => {

        const canActivate = await this.canActivate(request);
        if (!canActivate) {
          return next();
        }

        try {
          const result = await this.run({ request, response, next } as any, new Map());
          if (result) {
            return writeHttpResponse(response, result);
          }
        } catch (e) {
          if (e instanceof FlowControl) {
            switch (e.type) {
              case 'abort':
                return writeHttpResponse(response, { kind: 'text', status: 500, body: 'Aborted' });
              case 'fail':
                return writeHttpResponse(response, { kind: 'text', status: 500, body: 'Internal Server Error' });
              case 'handled':
                return;
            }
          }
          console.log(e);
          return writeHttpResponse(response, { kind: 'text', status: 500, body: 'Internal Server Error' });
        }
        // TODO: must be configured to throw error or not
        //       this line will be reach if the flow is not controlling the response
        return next();
      });
    }

    // else just put in the registry
    return Promise.resolve();
  }

  async canActivate(request: ServerRequest): Promise<boolean> {
    if (this.method) {
      if (request.method !== this.method) {
        return false;
      }
    }

    const canActivate = this.metadata.middleware?.canActivate ?? [];
    if (this.FlowClass['canActivate']) {
      canActivate.push(this.FlowClass['canActivate']);
    }
    if (canActivate.length === 0) {
      return true;
    }
    const results = await Promise.all(canActivate.map(m => m(request, this.scope)));
    return results.every(r => r);
  }

  async run(input: FlowInputOf<Name>, deps: Map<Token, Type>): Promise<FlowOutputOf<Name> | undefined> {
    const scope = this.globalProviders.getActiveScope();

    const { hooks, FlowClass, plan } = this;
    const context = new FlowClass(this.metadata, input, scope) as any;
    try {
      for (const pre of plan.pre ?? []) {
        for (const stage of hooks[pre] ?? []) {
          await stage.method(context);
        }
      }
      for (const execute of plan.execute ?? []) {
        for (const stage of hooks[execute] ?? []) {
          await stage.method(context);
        }
      }
      for (const post of plan.post ?? []) {
        for (const stage of hooks[post] ?? []) {
          await stage.method(context);
        }
      }

      for (const post of plan.finalize ?? []) {
        for (const stage of hooks[post] ?? []) {
          await stage.method(context);
        }
      }
    } catch (e) {
      if (e instanceof FlowControl) {
        switch (e.type) {
          case 'respond':
            return e.output;
          case 'next':
            return undefined;
        }
      }
      throw e;
    }
    return undefined;
  }
}