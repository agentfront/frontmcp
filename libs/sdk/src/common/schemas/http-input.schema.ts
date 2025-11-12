import { z } from 'zod';


export const httpInputSchema = z.object({
  request: z.object({}).passthrough(), // TODO: must be validated
  response: z.object({}).passthrough(),
  next: z.function().optional(),
});

export const httpRequestInputSchema = z.object({
  request: z.object({}).passthrough(), // TODO: must be validated
});