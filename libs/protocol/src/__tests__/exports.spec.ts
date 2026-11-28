import { IncomingMessage as NodeIncomingMessage, ServerResponse as NodeServerResponse } from 'http';

import { NodeStreamableHTTPServerTransport as SdkStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import {
  LATEST_PROTOCOL_VERSION,
  InMemoryTransport as SdkInMemoryTransport,
  Server as SdkServer,
  WebStandardStreamableHTTPServerTransport as SdkWebStandardTransport,
} from '@modelcontextprotocol/server';
import { StdioServerTransport as SdkStdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { AjvJsonSchemaValidator as SdkAjvJsonSchemaValidator } from '@modelcontextprotocol/server/validators/ajv';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/server/validators/cf-worker';

import {
  AjvJsonSchemaValidator as BrowserAjvJsonSchemaValidator,
  Server as BrowserServer,
} from '../browser-mcp-server';
import * as browserStreamableHttp from '../browser-mcp-streamable-http';
import * as browserServerTypes from '../browser-server-types';
import { StdioClientTransport as BrowserStdioClientTransport } from '../browser-stdio-client';
import { StdioServerTransport as BrowserStdioServerTransport } from '../browser-stdio-server';
import * as clients from '../clients';
import { InMemoryTransport } from '../in-memory';
import * as protocol from '../index';
import { AjvJsonSchemaValidator as NodeAjvJsonSchemaValidator, Server as NodeServer } from '../node-mcp-server';
import * as nodeStreamableHttp from '../node-mcp-streamable-http';
import * as nodeServerTypes from '../node-server-types';
import { StdioServerTransport as NodeStdioServerTransport } from '../node-stdio-server';
import { StdioServerTransport } from '../stdio';
import { isProtocol20260728, PROTOCOL_2026_07_28, readDeclaredProtocolVersion } from '../types-20260728';

describe('@frontmcp/protocol exports', () => {
  it('re-exports the MCP SDK server, transports and types for Node', () => {
    // FrontMCP's server is v2's, with the v1 handler registration on top
    expect(NodeServer.prototype).toBeInstanceOf(SdkServer);
    expect(BrowserServer).toBe(NodeServer);
    expect(NodeAjvJsonSchemaValidator).toBe(SdkAjvJsonSchemaValidator);
    expect(BrowserAjvJsonSchemaValidator).toBe(CfWorkerJsonSchemaValidator);
    expect(nodeStreamableHttp.StreamableHTTPServerTransport).toBe(SdkStreamableHTTPServerTransport);
    expect(nodeStreamableHttp.WebStandardStreamableHTTPServerTransport).toBe(SdkWebStandardTransport);
    expect(NodeStdioServerTransport.prototype).toBeInstanceOf(SdkStdioServerTransport);
    expect(StdioServerTransport).toBe(NodeStdioServerTransport);
    expect(InMemoryTransport).toBe(SdkInMemoryTransport);
    expect(nodeServerTypes.IncomingMessage).toBe(NodeIncomingMessage);
    expect(nodeServerTypes.HttpServerResponse).toBe(NodeServerResponse);
  });

  it('exports the protocol surface from the package root', () => {
    expect(protocol.LATEST_PROTOCOL_VERSION).toBe(LATEST_PROTOCOL_VERSION);
    expect(protocol.AjvJsonSchemaValidator).toBe(SdkAjvJsonSchemaValidator);
    expect(protocol.PROTOCOL_2026_07_28).toBe('2026-07-28');
    expect(protocol.StdioServerTransport).toBe(NodeStdioServerTransport);
  });

  it('serves the MCP client and its transports from the client subpath, not the root', () => {
    for (const name of ['Client', 'StreamableHTTPClientTransport', 'SSEClientTransport', 'StdioClientTransport']) {
      expect(typeof (clients as Record<string, unknown>)[name]).toBe('function');
      expect(name in protocol).toBe(false);
    }
  });

  it('gives browsers stand-ins that say what is not available', () => {
    expect(() => new browserStreamableHttp.StreamableHTTPServerTransport()).toThrow(
      'StreamableHTTPServerTransport is not available in browser environments',
    );
    expect(() => new browserStreamableHttp.WebStandardStreamableHTTPServerTransport()).toThrow(
      'WebStandardStreamableHTTPServerTransport is not available in browser environments',
    );
    expect(() => new BrowserStdioClientTransport()).toThrow(
      'StdioClientTransport is not available in browser environments',
    );
    expect(() => new BrowserStdioServerTransport()).toThrow(
      'StdioServerTransport is not available in browser environments',
    );
    expect(new browserServerTypes.IncomingMessage().headers).toEqual({});
    expect(new browserServerTypes.HttpServerResponse().end()).toBeUndefined();
  });

  it('reads the 2026-07-28 protocol version a request declares', () => {
    expect(isProtocol20260728(PROTOCOL_2026_07_28)).toBe(true);
    expect(isProtocol20260728('2025-11-25')).toBe(false);
    const declared = { params: { _meta: { 'io.modelcontextprotocol/protocolVersion': PROTOCOL_2026_07_28 } } };
    expect(readDeclaredProtocolVersion(declared)).toBe(PROTOCOL_2026_07_28);
    expect(
      readDeclaredProtocolVersion({ params: { _meta: { 'io.modelcontextprotocol/protocolVersion': 7 } } }),
    ).toBeUndefined();
    expect(readDeclaredProtocolVersion({ params: {} })).toBeUndefined();
    expect(readDeclaredProtocolVersion(undefined)).toBeUndefined();
  });
});
