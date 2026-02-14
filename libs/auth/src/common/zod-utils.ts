import { z } from 'zod';

export type RawZodShape<Type, Base = unknown> = {
  [K in keyof Omit<Type, keyof Base>]-?: z.ZodTypeAny;
};
