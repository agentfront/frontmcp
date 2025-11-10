import {z} from 'zod';
import {BaseEntry, EntryOwnerRef} from './base.entry';
import {ToolRecord} from '../records';
import {ToolContext} from '../interfaces';
import {ToolMetadata} from '../metadata';
import {Request, Notification, CallToolRequest} from "@modelcontextprotocol/sdk/types.js";
import {RequestHandlerExtra} from "@modelcontextprotocol/sdk/shared/protocol.js";
import {AuthInfo} from "@modelcontextprotocol/sdk/server/auth/types.js";


export type ToolCallArgs = CallToolRequest["params"]["arguments"];
export type ToolCallExtra = RequestHandlerExtra<Request, Notification> & {
  authInfo: AuthInfo;
};

export abstract class ToolEntry<In extends object = any, Out extends object = any> extends BaseEntry<ToolRecord, ToolContext<In, Out>, ToolMetadata> {
  owner: EntryOwnerRef;
  inputSchema: z.ZodObject<any>;
  rawInputSchema: z.ZodObject<any>;
  outputSchema: z.ZodObject<any>;

  abstract create(input: ToolCallArgs, ctx: ToolCallExtra): ToolContext<In, Out>;
}
