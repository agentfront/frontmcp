import { IncomingMessage as NodeIncomingMessage, ServerResponse as NodeServerResponse } from 'http';

import { InMemoryTransport as SdkInMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server as SdkServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport as SdkStdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport as SdkStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { WebStandardStreamableHTTPServerTransport as SdkWebStandardTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';

import { Server as BrowserServer } from '../browser-mcp-server';
import * as browserStreamableHttp from '../browser-mcp-streamable-http';
import * as browserServerTypes from '../browser-server-types';
import { StdioClientTransport as BrowserStdioClientTransport } from '../browser-stdio-client';
import { StdioServerTransport as BrowserStdioServerTransport } from '../browser-stdio-server';
import { InMemoryTransport } from '../in-memory';
import * as protocol from '../index';
import { Server as NodeServer } from '../node-mcp-server';
import * as nodeStreamableHttp from '../node-mcp-streamable-http';
import * as nodeServerTypes from '../node-server-types';
import { StdioServerTransport as NodeStdioServerTransport } from '../node-stdio-server';
import { StdioServerTransport } from '../stdio';
import { isProtocol20260728, PROTOCOL_2026_07_28, readDeclaredProtocolVersion } from '../types-20260728';

describe('@frontmcp/protocol exports', () => {
  it('re-exports the MCP SDK server, transports and types for Node', () => {
    expect(NodeServer).toBe(SdkServer);
    expect(BrowserServer).toBe(SdkServer);
    expect(nodeStreamableHttp.StreamableHTTPServerTransport).toBe(SdkStreamableHTTPServerTransport);
    expect(nodeStreamableHttp.WebStandardStreamableHTTPServerTransport).toBe(SdkWebStandardTransport);
    expect(NodeStdioServerTransport).toBe(SdkStdioServerTransport);
    expect(StdioServerTransport).toBe(SdkStdioServerTransport);
    expect(InMemoryTransport).toBe(SdkInMemoryTransport);
    expect(nodeServerTypes.IncomingMessage).toBe(NodeIncomingMessage);
    expect(nodeServerTypes.HttpServerResponse).toBe(NodeServerResponse);
  });

  it('exports the protocol surface from the package root', () => {
    expect(protocol.LATEST_PROTOCOL_VERSION).toBe(LATEST_PROTOCOL_VERSION);
    expect(protocol.PROTOCOL_2026_07_28).toBe('2026-07-28');
    expect(protocol.StdioServerTransport).toBe(SdkStdioServerTransport);
    expect(typeof protocol.Client).toBe('function');
    expect(typeof protocol.StreamableHTTPClientTransport).toBe('function');
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
