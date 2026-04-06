// file: libs/sdk/src/channel/sources/webhook.source.ts

import type { FrontMcpLogger } from '../../common';
import type { ChannelInstance } from '../channel.instance';
import type { ChannelWebhookSource } from '../../common/metadata/channel.metadata';

/**
 * Webhook request context passed to channel handlers.
 */
export interface WebhookPayload {
  /** The raw request body */
  body: unknown;
  /** Request headers (lowercase keys) */
  headers: Record<string, string | string[] | undefined>;
  /** HTTP method */
  method: string;
  /** Query parameters */
  query?: Record<string, string>;
}

/**
 * Creates an Express/Fastify-compatible middleware handler for a webhook channel.
 *
 * The middleware:
 * 1. Accepts POST requests at the configured path
 * 2. Passes the request body as the payload to the channel's onEvent handler
 * 3. Pushes the resulting notification to all capable Claude Code sessions
 * 4. Returns 200 on success, 500 on error
 *
 * @param channel - The channel instance
 * @param sourceConfig - The webhook source configuration
 * @param logger - Logger instance
 * @returns A middleware function compatible with Express/Fastify
 */
export function createWebhookMiddleware(
  channel: ChannelInstance,
  sourceConfig: ChannelWebhookSource,
  logger: FrontMcpLogger,
): (
  req: { body?: unknown; headers?: Record<string, unknown>; method?: string; query?: unknown },
  res: { status: (code: number) => { json: (body: unknown) => void }; json?: (body: unknown) => void },
) => Promise<void> {
  return async (req, res) => {
    // Normalize header keys to lowercase for consistent access
    const rawHeaders = req.headers ?? {};
    const normalizedHeaders: Record<string, string | string[] | undefined> = {};
    for (const [key, value] of Object.entries(rawHeaders)) {
      normalizedHeaders[key.toLowerCase()] = value as string | string[] | undefined;
    }

    const payload: WebhookPayload = {
      body: req.body,
      headers: normalizedHeaders,
      method: req.method ?? 'POST',
      query: req.query as Record<string, string> | undefined,
    };

    logger.verbose(`Webhook received for channel "${channel.name}" at ${sourceConfig.path}`);

    try {
      const notification = await channel.handleEvent(payload);
      if (notification) {
        res.status(200).json({ ok: true, channel: channel.name });
      } else {
        res.status(200).json({ ok: true, channel: channel.name, skipped: true });
      }
    } catch (err) {
      logger.error(`Webhook handler failed for channel "${channel.name}"`, { error: err });
      res.status(500).json({ ok: false, error: 'Internal channel error' });
    }
  };
}
