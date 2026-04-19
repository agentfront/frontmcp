import { type z } from '@frontmcp/lazy-zod';

export type RawZodShape<Type, Base = {}> = {
  [K in keyof Omit<Type, keyof Base>]-?: z.ZodTypeAny;
};
export type RawMetadataShape<Type, Base = {}> = {
  [K in keyof Omit<Type, keyof Base>]-?: symbol;
} & { type: symbol } & { [K in any]: symbol };
