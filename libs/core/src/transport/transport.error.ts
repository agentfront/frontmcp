import { JSONRPCError, JSONRPCMessage, RequestId } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';

const JSON_RPC = '2.0';

export const noValidSessionError = (): JSONRPCError => ({
  jsonrpc: JSON_RPC,
  error: { code: -32000, message:'Bad Request: No valid session ID provided' },
  id: randomUUID(),
});

export const rpcError = (message: string, requestId?: RequestId | null): JSONRPCError => ({
  jsonrpc: JSON_RPC,
  error: { code: -32000, message },
  id: requestId ?? randomUUID(), // change it to request id + random
});

export const rpcRequest = (requestId: RequestId,method: string, params: any): JSONRPCMessage => ({
  jsonrpc: JSON_RPC,
  id: requestId ?? randomUUID(),
  method,
  params,
});
