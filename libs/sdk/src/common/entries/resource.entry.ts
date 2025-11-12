import { z } from 'zod';
import { BaseEntry } from './base.entry';
import { ResourceRecord } from '../records';
import { ResourceInterface } from '../interfaces';
import { ResourceMetadata } from '../metadata';


export abstract class ResourceEntry<In = z.ZodRawShape, Out = z.ZodRawShape> extends BaseEntry<
  ResourceRecord, ResourceInterface<In, Out>, ResourceMetadata> {


}


// TODO: support resource templates
// abstract class ResourceTemplateEntry<In = z.ZodRawShape, Out = z.ZodRawShape> extends BaseEntry<ResourceTemplateRecord, ResourceTemplateInterface<In, Out>, ResourceTemplateType> {
// }