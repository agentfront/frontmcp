// The MCP Server for browser builds: v2's server picks its browser shims through its own export conditions.
export { Server, type ServerOptions } from './compat-server';
// v2's Ajv validator is a 154 KB pre-bundled build of Ajv; its `@cfworker/json-schema` one (which its browser shims
// load anyway) checks the same schemas, so a browser bundle ships only that one.
export { CfWorkerJsonSchemaValidator as AjvJsonSchemaValidator } from '@modelcontextprotocol/server/validators/cf-worker';
