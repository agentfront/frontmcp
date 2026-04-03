export { startSpan, endSpanOk, endSpanError, withSpan } from './span.utils';
export type { StartSpanOptions } from './span.utils';

export { startHttpServerSpan, setHttpResponseStatus } from './http-server.span';
export type { HttpServerSpanOptions } from './http-server.span';

export { startRpcSpan } from './rpc.span';
export type { RpcSpanOptions } from './rpc.span';

export { startToolSpan } from './tool.span';
export type { ToolSpanOptions } from './tool.span';

export { startResourceSpan } from './resource.span';
export type { ResourceSpanOptions } from './resource.span';

export { startPromptSpan } from './prompt.span';
export type { PromptSpanOptions } from './prompt.span';

export { recordHookEvent, startHookSpan } from './hook.span';
export type { HookSpanOptions } from './hook.span';

export { startFetchSpan, setFetchResponseStatus } from './fetch.span';
export type { FetchSpanOptions } from './fetch.span';

export { startTransportSpan, setTransportRequestType } from './transport.span';
export type { TransportSpanOptions } from './transport.span';

export { startAuthSpan, setAuthMode, setAuthResult } from './auth.span';
export type { AuthSpanOptions } from './auth.span';

export { emitStartupReport } from './startup.span';
export type { StartupTelemetryData } from './startup.span';
