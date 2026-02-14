import { z } from 'zod';

export type RawZodShape<Type, Base = {}> = {
  [K in keyof Omit<Type, keyof Base>]-?: z.ZodTypeAny;
};
