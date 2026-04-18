/**
 * DSL describing a schema shape.
 * The generator walks these to emit both (a) a Zod expression string
 * and (b) a matching sample payload.
 */

export type PrimitiveKind = 'string' | 'number' | 'boolean';

export type FieldDescriptor =
  | { name: string; type: PrimitiveKind; optional?: boolean }
  | { name: string; type: 'enum'; values: string[]; optional?: boolean }
  | { name: string; type: 'array'; items: PrimitiveKind; optional?: boolean }
  | { name: string; type: 'record'; keys: string[]; optional?: boolean }
  | { name: string; type: 'object'; children: FieldDescriptor[]; optional?: boolean };

export type VariantDescriptor = {
  tag: string;
  fields: FieldDescriptor[];
};

export type SchemaDescriptor =
  | { name: string; kind: 'object'; fields: FieldDescriptor[]; refine?: boolean }
  | {
      name: string;
      kind: 'discriminated';
      discriminator: string;
      variants: VariantDescriptor[];
    }
  | {
      name: string;
      kind: 'union';
      members: SchemaDescriptor[];
    }
  | {
      name: string;
      kind: 'array-of-objects';
      item: FieldDescriptor[];
    };
