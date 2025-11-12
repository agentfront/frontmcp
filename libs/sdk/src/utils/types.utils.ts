import { z, ZodTypeAny } from 'zod';

type Primitive = string | number | boolean | bigint | null | undefined;
type Flatten<T> = T extends Primitive
  ? T
  : T extends Array<infer U>
    ? Array<Flatten<U>>
    : T extends Set<infer U>
      ? Set<Flatten<U>>
      : T extends Map<infer K, infer V>
        ? Map<Flatten<K>, Flatten<V>>
        : T extends object
          ? {
            [K in keyof T]: Flatten<T[K]>;
          }
          : T;
export type Infer<Schema extends ZodTypeAny> = Flatten<z.infer<Schema>>;
