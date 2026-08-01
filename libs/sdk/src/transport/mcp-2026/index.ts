/**
 * MCP protocol revision 2026-07-28 support.
 *
 * Everything in here is additive: a request is only routed through this module
 * when it explicitly declares the 2026-07-28 revision (or uses a method that
 * exists only in it). Every earlier revision keeps its original code path.
 *
 * @module transport/mcp-2026
 */
export * from './protocol-2026.constants';
export * from './header-codec';
export * from './request-validation';
export * from './request-state';
export * from './request-notifications';
export * from './result-decorator';
export * from './discover';
export * from './mrtr';
export * from './subscriptions';
export * from './tasks-extension';
export * from './dispatcher';
export * from './client';
