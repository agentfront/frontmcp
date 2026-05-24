// common/types/options/metrics/schema.ts
//
// Configuration schema for the /metrics endpoint (issue #397).

import { z } from '@frontmcp/lazy-zod';

import type { RawZodShape } from '../../common.types';
import type { MetricsOptionsInterface, MetricsProcessOptionsInterface } from './interfaces';

export type { MetricsOptionsInterface, MetricsProcessOptionsInterface };

export const metricsProcessOptionsSchema = z.object({
  eventLoopLag: z.boolean().optional(),
  fdCount: z.boolean().optional(),
  activeHandles: z.boolean().optional(),
} satisfies RawZodShape<MetricsProcessOptionsInterface>);

const metricsAuthSchema = z.union([z.literal('public'), z.literal('token'), z.object({ token: z.string().min(1) })]);

export const metricsOptionsSchema = z.object({
  enabled: z.boolean().optional().default(false),
  path: z.string().optional().default('/metrics'),
  format: z
    .union([z.literal('prometheus'), z.literal('json')])
    .optional()
    .default('prometheus'),
  auth: metricsAuthSchema.optional().default('public'),
  tokenEnv: z.string().optional().default('FRONTMCP_METRICS_TOKEN'),
  include: z
    .array(
      z.union([
        z.literal('process'),
        z.literal('tools'),
        z.literal('resources'),
        z.literal('http'),
        z.literal('storage'),
        z.literal('skills'),
        z.literal('auth'),
        z.literal('sessions'),
      ]),
    )
    .optional(),
  process: metricsProcessOptionsSchema.optional(),
} satisfies RawZodShape<MetricsOptionsInterface>);

/**
 * Default metrics configuration values.
 *
 * The endpoint is OFF by default. Enabling it is a deliberate decision —
 * see `MetricsOptionsInterface` for the rationale.
 */
export const DEFAULT_METRICS_OPTIONS: Pick<
  Required<MetricsOptionsInterface>,
  'enabled' | 'path' | 'format' | 'auth' | 'tokenEnv'
> = {
  enabled: false,
  path: '/metrics',
  format: 'prometheus',
  auth: 'public',
  tokenEnv: 'FRONTMCP_METRICS_TOKEN',
};

export type MetricsOptions = z.infer<typeof metricsOptionsSchema>;
export type MetricsOptionsInput = MetricsOptionsInterface;
