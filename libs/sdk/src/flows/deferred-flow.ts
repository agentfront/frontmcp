import 'reflect-metadata';

import { FlowBase, FrontMcpFlowTokens, type FlowName, type FlowType, type HttpMethod } from '../common';

/** What a deferred flow is registered by before its class loads: its name and its route. */
export interface DeferredFlowDeclaration {
  name: FlowName;
  middleware: { path: string; method?: HttpMethod };
}

const flowClassLoaders = new WeakMap<FlowType, () => Promise<FlowType>>();

/**
 * A flow registered under its name and route like any flow, whose class loads the first time a request reaches the
 * route or the flow runs.
 */
export function deferredFlow(declaration: DeferredFlowDeclaration, load: () => Promise<FlowType>): FlowType {
  class DeferredFlow extends FlowBase {}
  Reflect.defineMetadata(FrontMcpFlowTokens.type, true, DeferredFlow);
  Reflect.defineMetadata(FrontMcpFlowTokens.name, declaration.name, DeferredFlow);
  Reflect.defineMetadata(FrontMcpFlowTokens.middleware, declaration.middleware, DeferredFlow);
  flowClassLoaders.set(DeferredFlow, load);
  return DeferredFlow;
}

/** The loader of the class a flow registered with {@link deferredFlow} stands for. */
export function deferredFlowLoader(flowClass: FlowType): (() => Promise<FlowType>) | undefined {
  return flowClassLoaders.get(flowClass);
}
