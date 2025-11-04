import { z } from 'zod';
import { BaseEntry } from './base.entry';
import { ToolRecord } from '../records';
import { ToolInterface } from '../interfaces';
import { ToolMetadata } from '../metadata';


export abstract class ToolEntry<In = z.ZodRawShape, Out = z.ZodRawShape> extends BaseEntry<ToolRecord, ToolInterface<In, Out>, ToolMetadata> {

}
