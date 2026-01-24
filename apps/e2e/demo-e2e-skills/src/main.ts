import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { SkillsE2EApp } from './apps/skills';

const port = parseInt(process.env['PORT'] ?? '3107', 10);

@FrontMcp({
  info: { name: 'Demo E2E Skills', version: '0.1.0' },
  apps: [SkillsE2EApp],
  logging: { level: LogLevel.Info },
  http: { port },
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
