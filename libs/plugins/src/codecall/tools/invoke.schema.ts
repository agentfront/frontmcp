// file: libs/plugins/src/codecall/tools/invoke.schema.ts
import { z } from 'zod';

export const invokeToolInputSchema = {

};

export type InvokeToolInput = z.baseObjectInputType<typeof invokeToolInputSchema>;

export const invokeToolOutputSchema = z.object({}).passthrough();
export type InvokeToolOutput = z.infer<typeof invokeToolOutputSchema>;
