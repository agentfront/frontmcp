import {z} from 'zod';
import {BaseEntry, EntryOwnerRef} from './base.entry';
import {ToolRecord} from '../records';
import {ToolContext} from '../interfaces';
import {ToolMetadata} from '../metadata';
import {Request, Notification, CallToolRequest} from "@modelcontextprotocol/sdk/types.js";
import {RequestHandlerExtra} from "@modelcontextprotocol/sdk/shared/protocol.js";


export type ToolCallArgs = CallToolRequest["params"]["arguments"];
export type ToolCallExtra = RequestHandlerExtra<Request, Notification>;

export abstract class ToolEntry<In = z.ZodRawShape, Out = z.ZodRawShape> extends BaseEntry<ToolRecord, ToolContext<In, Out>, ToolMetadata> {
  owner: EntryOwnerRef;
  inputSchema: z.ZodObject<any>;
  outputSchema: z.ZodObject<any>;

  abstract create(input: ToolCallArgs, ctx: ToolCallExtra): ToolContext<In, Out>;
}
