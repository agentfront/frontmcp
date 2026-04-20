import { type z } from '@frontmcp/lazy-zod';

export type RawZodShape<Type, Base = unknown> = {
  [K in keyof Omit<Type, keyof Base>]-?: z.ZodTypeAny;
};
