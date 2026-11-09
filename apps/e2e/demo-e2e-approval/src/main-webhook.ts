import { ApprovalPlugin } from '@frontmcp/plugin-approval';
import { App, FrontMcp, LogLevel, type ServerRequest, type ServerResponse } from '@frontmcp/sdk';

import { opsTools } from './apps/ops/tools';

const port = parseInt(process.env['PORT'] ?? '3122', 10);
const secret = process.env['APPROVAL_WEBHOOK_SECRET'] ?? 'demo-e2e-approval-webhook-secret-0123';

interface ReceivedApprovalRequest {
  headers: Record<string, unknown>;
  body: string;
}

/** The approval requests the server sent to its own inbox route, which stands in for the approval system. */
const approvalInbox: ReceivedApprovalRequest[] = [];

/** `mode: 'webhook'`: a refused call sends a signed request to the inbox below, and the decision comes back on `/approval/callback`. */
@App({
  id: 'ops',
  name: 'Ops',
  plugins: [
    ApprovalPlugin.init({
      storage: { type: 'memory' },
      mode: 'webhook',
      webhook: { url: `http://127.0.0.1:${port}/test/approval-inbox`, secret },
    }),
  ],
  tools: opsTools,
})
class OpsWebhookApp {}

@FrontMcp({
  info: { name: 'Demo E2E Approval (webhook)', version: '0.1.0' },
  apps: [OpsWebhookApp],
  logging: { level: LogLevel.Warn },
  http: {
    port,
    routes: [
      {
        method: 'POST',
        path: '/test/approval-inbox',
        handler: (req: ServerRequest, res: ServerResponse) => {
          approvalInbox.push({ headers: req.headers, body: new TextDecoder().decode(req.bodyBytes) });
          res.status(200).json({ received: true });
        },
      },
      {
        method: 'GET',
        path: '/test/approval-inbox',
        handler: (_req: ServerRequest, res: ServerResponse) => {
          res.status(200).json(approvalInbox);
        },
      },
    ],
  },
  auth: {
    mode: 'public',
    sessionTtl: 3600,
    anonymousScopes: ['anonymous'],
  },
  transport: {
    protocol: { json: true, legacy: true, strictSession: false },
  },
})
export default class Server {}
